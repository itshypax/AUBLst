<?php
declare(strict_types=1);

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
    if ($stmt->fetch()) {
        ensure_indexes($pdo);
        return;
    }
    $sql = file_get_contents(__DIR__ . '/schema.sql');
    foreach (preg_split('/;\s*\n/', $sql) as $statement) {
        $statement = trim($statement);
        if ($statement === '' || str_starts_with($statement, '--')) {
            continue;
        }
        $pdo->exec($statement);
    }
}

function ensure_indexes(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS hospital_reservations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id INT NOT NULL,
        vehicle_id INT NOT NULL,
        hospital_id INT NOT NULL,
        bed_type ENUM('ward','icu') NOT NULL,
        status ENUM('reserved','arrived') NOT NULL DEFAULT 'reserved',
        baseline_available INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        arrived_at TIMESTAMP NULL,
        UNIQUE KEY uniq_hospital_reservation_vehicle (session_id, vehicle_id),
        INDEX idx_hospital_reservation_capacity (session_id, hospital_id, bed_type, status),
        CONSTRAINT fk_hospital_reservation_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        CONSTRAINT fk_hospital_reservation_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
        CONSTRAINT fk_hospital_reservation_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS alarm_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id INT NOT NULL,
        command_id INT NULL,
        event_id INT NULL,
        event_name VARCHAR(255) NULL,
        vehicle_id INT NULL,
        game_vehicle_id VARCHAR(255) NOT NULL,
        vehicle_name VARCHAR(255) NULL,
        assigned_player_id INT NULL,
        player_name VARCHAR(255) NULL,
        mode VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_alarm_history_command (command_id),
        INDEX idx_alarm_history_session (session_id, created_at, id),
        INDEX idx_alarm_history_event (session_id, event_id, created_at),
        INDEX idx_alarm_history_vehicle (session_id, vehicle_id, created_at),
        CONSTRAINT fk_alarm_history_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB");
    $stmt = $pdo->query("SHOW INDEX FROM activity_logs WHERE Key_name = 'idx_session_updated'");
    if (!$stmt->fetch()) {
        $pdo->exec('ALTER TABLE activity_logs ADD INDEX idx_session_updated (session_id, updated_at, id)');
    }
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
}
