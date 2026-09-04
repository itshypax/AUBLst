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
        '2026081102_vehicle_status_history' => static function (PDO $pdo): void {
            $pdo->exec("CREATE TABLE IF NOT EXISTS vehicle_status_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                session_id INT NOT NULL,
                vehicle_id INT NOT NULL,
                game_vehicle_id VARCHAR(255) NOT NULL,
                vehicle_name VARCHAR(255) NULL,
                status TINYINT UNSIGNED NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_vehicle_status_session (session_id, created_at, id),
                INDEX idx_vehicle_status_vehicle (session_id, vehicle_id, created_at, id),
                CONSTRAINT fk_vehicle_status_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                CONSTRAINT fk_vehicle_status_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
            ) ENGINE=InnoDB");

            $pdo->exec("INSERT INTO vehicle_status_history
                (session_id, vehicle_id, game_vehicle_id, vehicle_name, status, created_at)
                SELECT session_id, id, game_vehicle_id, name, status, CURRENT_TIMESTAMP
                FROM vehicles WHERE status BETWEEN 0 AND 9");
        },
        '2026081501_activity_log_microseconds' => static function (PDO $pdo): void {
            $pdo->exec('ALTER TABLE activity_logs
                MODIFY updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)');
        },
        '2026081502_speech_request_occurrences' => static function (PDO $pdo): void {
            $pdo->exec("CREATE TABLE IF NOT EXISTS speech_request_occurrences (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                session_id INT NOT NULL,
                entity_id VARCHAR(255) NOT NULL,
                event_id INT NULL,
                state ENUM('active','inactive') NOT NULL DEFAULT 'active',
                active_marker TINYINT GENERATED ALWAYS AS (CASE WHEN state = 'active' THEN 1 ELSE NULL END) STORED,
                created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6),
                updated_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                UNIQUE KEY uniq_active_speech_request (session_id, entity_id, active_marker),
                INDEX idx_speech_request_session (session_id, created_at, id),
                CONSTRAINT fk_speech_request_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            ) ENGINE=InnoDB");
            if (!database_column_exists($pdo, 'activity_logs', 'occurrence_id')) {
                $pdo->exec('ALTER TABLE activity_logs
                    ADD COLUMN occurrence_id INT UNSIGNED NULL DEFAULT 0 AFTER message');
            }
            if (database_index_exists($pdo, 'activity_logs', 'uniq_activity_log')) {
                $pdo->exec('ALTER TABLE activity_logs DROP INDEX uniq_activity_log');
            }
            if (!database_index_exists($pdo, 'activity_logs', 'uniq_activity_log_occurrence')) {
                $pdo->exec('ALTER TABLE activity_logs
                    ADD UNIQUE KEY uniq_activity_log_occurrence (session_id, entity_id, message, occurrence_id)');
            }
        },
        '2026081503_speech_request_lifecycle' => static function (PDO $pdo): void {
            $pdo->exec("CREATE TABLE IF NOT EXISTS speech_request_occurrences (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                session_id INT NOT NULL,
                entity_id VARCHAR(255) NOT NULL,
                event_id INT NULL,
                state ENUM('active','inactive') NOT NULL DEFAULT 'active',
                active_marker TINYINT GENERATED ALWAYS AS (CASE WHEN state = 'active' THEN 1 ELSE NULL END) STORED,
                created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6),
                updated_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                UNIQUE KEY uniq_active_speech_request (session_id, entity_id, active_marker),
                INDEX idx_speech_request_session (session_id, created_at, id),
                CONSTRAINT fk_speech_request_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            ) ENGINE=InnoDB");
            $pdo->exec('UPDATE activity_logs SET occurrence_id = 0 WHERE occurrence_id > 0');
            $pdo->exec("INSERT INTO speech_request_occurrences
                (session_id, entity_id, event_id, state, created_at, updated_at)
                SELECT session_id, entity_id, MAX(event_id), 'active', MIN(created_at), MAX(updated_at)
                FROM activity_logs
                WHERE state = 'active' AND entity_id IS NOT NULL AND entity_id <> ''
                  AND (
                    LOWER(message) LIKE '%sprechwunsch%'
                    OR LOWER(long_message) LIKE '%sprechwunsch%'
                    OR LOWER(REPLACE(message, ' ', '')) IN ('5', 's5', 'status5', 'fms5')
                  )
                GROUP BY session_id, entity_id
                ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)");
            $pdo->exec("UPDATE activity_logs l
                JOIN speech_request_occurrences o
                  ON o.session_id = l.session_id AND o.entity_id = l.entity_id AND o.state = 'active'
                SET l.occurrence_id = o.id
                WHERE l.state = 'active' AND (
                    LOWER(l.message) LIKE '%sprechwunsch%'
                    OR LOWER(l.long_message) LIKE '%sprechwunsch%'
                    OR LOWER(REPLACE(l.message, ' ', '')) IN ('5', 's5', 'status5', 'fms5')
                )");
        },
        '2026081601_realtime_and_metrics' => static function (PDO $pdo): void {
            if (!database_column_exists($pdo, 'sessions', 'revision')) {
                $pdo->exec('ALTER TABLE sessions ADD COLUMN revision BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER max_y');
            }
            $pdo->exec("CREATE TABLE IF NOT EXISTS anonymous_metrics (
                metric_day DATE NOT NULL,
                metric_name VARCHAR(64) NOT NULL,
                sample_count INT UNSIGNED NOT NULL DEFAULT 0,
                value_sum DOUBLE NOT NULL DEFAULT 0,
                value_max DOUBLE NOT NULL DEFAULT 0,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (metric_day, metric_name)
            ) ENGINE=InnoDB");
        },
        '2026081602_speech_request_acknowledgement' => static function (PDO $pdo): void {
            if (!database_column_exists($pdo, 'activity_logs', 'acknowledged')) {
                $pdo->exec('ALTER TABLE activity_logs
                    ADD COLUMN acknowledged TINYINT(1) NOT NULL DEFAULT 0 AFTER state');
            }
        },
        '2026081801_event_leaders' => static function (PDO $pdo): void {
            $pdo->exec("CREATE TABLE IF NOT EXISTS event_leaders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                session_id INT NOT NULL,
                event_id INT NOT NULL,
                vehicle_id INT NOT NULL,
                role ENUM('fire','medical') NOT NULL,
                source ENUM('automatic','manual') NOT NULL DEFAULT 'manual',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_event_leader_role (event_id, role),
                UNIQUE KEY uniq_event_leader_vehicle (event_id, vehicle_id),
                INDEX idx_event_leader_session (session_id, event_id),
                CONSTRAINT fk_event_leader_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                CONSTRAINT fk_event_leader_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
                CONSTRAINT fk_event_leader_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
            ) ENGINE=InnoDB");
        },
        '2026081802_event_leader_source' => static function (PDO $pdo): void {
            if (!database_column_exists($pdo, 'event_leaders', 'source')) {
                $pdo->exec("ALTER TABLE event_leaders
                    ADD COLUMN source ENUM('automatic','manual') NOT NULL DEFAULT 'automatic' AFTER role");
                $pdo->exec("ALTER TABLE event_leaders
                    MODIFY source ENUM('automatic','manual') NOT NULL DEFAULT 'manual'");
            }
        },
        '2026090101_monitor_hospital_capacity' => static function (PDO $pdo): void {
            if (!database_column_exists($pdo, 'sessions', 'monitor_show_hospital_capacity')) {
                $pdo->exec('ALTER TABLE sessions
                    ADD COLUMN monitor_show_hospital_capacity TINYINT(1) NOT NULL DEFAULT 0 AFTER max_y');
            }
        },
        '2026090301_runtime_performance_and_replay' => static function (PDO $pdo): void {
            if (!database_column_exists($pdo, 'sessions', 'last_activity_at')) {
                $pdo->exec('ALTER TABLE sessions
                    ADD COLUMN last_activity_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER revision');
            }
            if (!database_index_exists($pdo, 'sessions', 'idx_sessions_activity')) {
                $pdo->exec('ALTER TABLE sessions ADD INDEX idx_sessions_activity (last_activity_at)');
            }
            if (!database_column_exists($pdo, 'assignments', 'last_position_sample_at')) {
                $pdo->exec('ALTER TABLE assignments
                    ADD COLUMN last_position_sample_at TIMESTAMP(6) NULL AFTER status');
            }
            $pdo->exec("CREATE TABLE IF NOT EXISTS event_journal (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                session_id INT NOT NULL,
                event_id INT NOT NULL,
                source ENUM('dispatcher','game','system') NOT NULL,
                action_type VARCHAR(64) NOT NULL,
                summary VARCHAR(1000) NOT NULL,
                payload JSON NULL,
                created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                INDEX idx_event_journal (session_id, event_id, created_at, id),
                CONSTRAINT fk_event_journal_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                CONSTRAINT fk_event_journal_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
            ) ENGINE=InnoDB");
            $pdo->exec("CREATE TABLE IF NOT EXISTS vehicle_position_history (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                session_id INT NOT NULL,
                event_id INT NOT NULL,
                vehicle_id INT NOT NULL,
                x DOUBLE NOT NULL,
                y DOUBLE NOT NULL,
                status TINYINT UNSIGNED NOT NULL,
                recorded_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                INDEX idx_position_replay (session_id, event_id, recorded_at, id),
                INDEX idx_position_vehicle (session_id, vehicle_id, recorded_at),
                CONSTRAINT fk_position_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                CONSTRAINT fk_position_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
                CONSTRAINT fk_position_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
            ) ENGINE=InnoDB");
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
