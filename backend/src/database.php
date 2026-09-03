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
        if ($bootstrap) ensure_schema($pdo);
    }
    return $pdo;
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
