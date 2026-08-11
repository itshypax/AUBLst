<?php
declare(strict_types=1);

function migration_definitions(): array {
    return [
        '2026080901_hospital_reservations' => static function (PDO $pdo): void {
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
        },
        '2026080902_alarm_history' => static function (PDO $pdo): void {
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
        },
        '2026080903_activity_log_cursor' => static function (PDO $pdo): void {
            if (!database_index_exists($pdo, 'activity_logs', 'idx_session_updated')) {
                $pdo->exec('ALTER TABLE activity_logs ADD INDEX idx_session_updated (session_id, updated_at, id)');
            }
        },
        '2026081001_auth_rate_limits' => static function (PDO $pdo): void {
            $pdo->exec("CREATE TABLE IF NOT EXISTS auth_rate_limits (
                client_key CHAR(64) PRIMARY KEY,
                failures SMALLINT UNSIGNED NOT NULL DEFAULT 0,
                window_started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                blocked_until TIMESTAMP NULL,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_auth_rate_limit_cleanup (updated_at)
            ) ENGINE=InnoDB");
        },
        '2026081002_mod_routing' => static function (PDO $pdo): void {
            if (!database_column_exists($pdo, 'mods', 'meters_per_world_unit')) {
                $pdo->exec('ALTER TABLE mods ADD COLUMN meters_per_world_unit DOUBLE NOT NULL DEFAULT 0.1 AFTER mime_type');
            }
            if (!database_column_exists($pdo, 'mods', 'routing_graph')) {
                $pdo->exec('ALTER TABLE mods ADD COLUMN routing_graph LONGTEXT NULL AFTER meters_per_world_unit');
            }
        },
        '2026081101_event_feedback' => static function (PDO $pdo): void {
            $pdo->exec("CREATE TABLE IF NOT EXISTS event_feedback (
                id INT AUTO_INCREMENT PRIMARY KEY,
                session_id INT NOT NULL,
                event_id INT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_event_feedback (session_id, event_id, created_at, id),
                CONSTRAINT fk_event_feedback_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                CONSTRAINT fk_event_feedback_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
            ) ENGINE=InnoDB");

            $pdo->exec("INSERT INTO event_feedback (session_id, event_id, content, created_at)
                SELECT n.session_id, n.event_id, n.content, n.created_at
                FROM notes n
                WHERE n.content <> ''
                  AND NOT EXISTS (
                    SELECT 1 FROM event_feedback f
                    WHERE f.session_id = n.session_id AND f.event_id = n.event_id
                  )");
        },
    ];
}

function database_column_exists(PDO $pdo, string $table, string $column): bool {
    $stmt = $pdo->prepare("SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1");
    $stmt->execute([$table, $column]);
    return (bool)$stmt->fetchColumn();
}

function database_index_exists(PDO $pdo, string $table, string $index): bool {
    $stmt = $pdo->prepare("SELECT 1 FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1");
    $stmt->execute([$table, $index]);
    return (bool)$stmt->fetchColumn();
}

function run_migrations(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB");

    $applied = [];
    foreach ($pdo->query('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN) as $version) {
        $applied[(string)$version] = true;
    }

    foreach (migration_definitions() as $version => $migrate) {
        if (isset($applied[$version])) continue;
        $migrate($pdo);
        $stmt = $pdo->prepare('INSERT INTO schema_migrations (version) VALUES (?)');
        $stmt->execute([$version]);
    }
}
