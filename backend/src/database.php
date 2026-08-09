<?php
declare(strict_types=1);

require_once __DIR__ . '/migrations.php';

function pdo_conn(): PDO {
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
        ensure_schema($pdo);
        maybe_cleanup($pdo);
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

// Sessions ohne Aktivität seit einer Stunde entsorgen, alles Zugehörige
// hängt per ON DELETE CASCADE dran. Läuft wie PHP-Session-GC nur ab und zu.
function maybe_cleanup(PDO $pdo): void {
    if (mt_rand(1, 50) !== 1) {
        return;
    }
    $pdo->exec("DELETE s
        FROM sessions s
        LEFT JOIN (
          SELECT session_id, MAX(created_at) AS last_log
          FROM activity_logs
          GROUP BY session_id
        ) l ON l.session_id = s.id
        LEFT JOIN (
          SELECT session_id, MAX(created_at) AS last_cmd
          FROM commands
          GROUP BY session_id
        ) c ON c.session_id = s.id
        WHERE GREATEST(
          IFNULL(s.updated_at, '1970-01-01'),
          IFNULL(l.last_log, '1970-01-01'),
          IFNULL(c.last_cmd, '1970-01-01')
        ) < (NOW() - INTERVAL 1 HOUR)");
    $pdo->exec("DELETE FROM auth_rate_limits WHERE updated_at < (NOW() - INTERVAL 1 DAY)");
}
