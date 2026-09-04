<?php
declare(strict_types=1);

require_once __DIR__ . '/migrations.php';

function pdo_conn(bool $bootstrap = false): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ];
        try {
            $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
        } catch (PDOException $e) {
            // 1049 = Datenbank fehlt noch, dann selbst anlegen
            if ((int)($e->errorInfo[1] ?? 0) !== 1049) {
                throw $e;
            }
            $server = new PDO('mysql:host=' . DB_HOST . ';charset=' . DB_CHARSET, DB_USER, DB_PASS, $options);
            $server->exec('CREATE DATABASE IF NOT EXISTS `' . str_replace('`', '', DB_NAME) . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
            $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
        }
        // TIMESTAMP-Spalten werden beim Lesen und Schreiben in die Zeitzone der
        // Verbindung umgerechnet. Ohne diese Zeile gilt die Zone des
        // Datenbankservers, im Docker-Container also UTC.
        $pdo->exec("SET time_zone = '" . db_session_time_zone(app_time_zone()) . "'");
        if ($bootstrap) ensure_schema($pdo);
    }
    return $pdo;
}

function app_time_zone(): DateTimeZone {
    $name = defined('APP_TIMEZONE') ? (string)APP_TIMEZONE : 'Europe/Berlin';
    try {
        return new DateTimeZone($name);
    } catch (Throwable) {
        return new DateTimeZone('Europe/Berlin');
    }
}

// Numerischer Offset wie '+02:00' statt Zonenname, weil Zonennamen in MariaDB
// nur mit geladenen Zeitzonentabellen funktionieren. Der Offset wird pro
// Verbindung zum aktuellen Zeitpunkt bestimmt, Sommer- und Winterzeit stimmen
// damit für alles, was während der Sitzung entsteht.
function db_session_time_zone(DateTimeZone $zone, ?DateTimeInterface $now = null): string {
    $now = $now ?? new DateTimeImmutable('now', $zone);
    $offset = $zone->getOffset($now);
    $sign = $offset < 0 ? '-' : '+';
    $offset = abs($offset);
    return sprintf('%s%02d:%02d', $sign, intdiv($offset, 3600), intdiv($offset % 3600, 60));
}

function ensure_schema(PDO $pdo): void {
    $stmt = $pdo->query("SHOW TABLES LIKE 'sessions'");
    if (!$stmt->fetch()) {
        $sql = file_get_contents(__DIR__ . '/schema.sql');
        foreach (preg_split('/;\s*\n/', $sql) as $statement) {
            $statement = trim($statement);
            if ($statement === '' || str_starts_with($statement, '--')) {
                continue;
            }
            $pdo->exec($statement);
        }
    }
    run_migrations($pdo);
}

function cleanup_expired_data(PDO $pdo): array {
    $ttl = (int)SESSION_TTL_SECONDS;
    $stmt = $pdo->prepare("DELETE FROM sessions
        WHERE last_activity_at < DATE_SUB(NOW(), INTERVAL $ttl SECOND)");
    $stmt->execute();
    $sessions = $stmt->rowCount();
    $pdo->exec("DELETE FROM auth_rate_limits WHERE updated_at < (NOW() - INTERVAL 1 DAY)");
    return ['sessions' => $sessions];
}
