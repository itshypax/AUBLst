<?php
declare(strict_types=1);

// Priority when merging updates: value from the request wins, then the stored
// row, then the default. Lets the game send partial updates.
function check_options(string $key, $saved, array $sent, $default = null) {
    if (isset($sent[$key])) {
        return $sent[$key];
    }
    if ($saved && isset($saved[$key])) {
        return $saved[$key];
    }
    return $default;
}

// Der Fremdschlüssel sessions.mod_id verlangt eine mods-Zeile; für Mods, deren
// Karte als Datei in backend/maps/ liegt, reicht dieser Platzhalter.
function ensure_mod_row(PDO $pdo, ?string $mod_id): void {
    if (!$mod_id) {
        return;
    }
    $stmt = $pdo->prepare('INSERT IGNORE INTO mods (mod_id) VALUES (?)');
    $stmt->execute([$mod_id]);
}

function touch_session(PDO $pdo, $session_id): void {
    $stmt = $pdo->prepare('UPDATE sessions SET revision = revision + 1,
        last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    $stmt->execute([$session_id]);
}

function mark_session_activity(PDO $pdo, $session_id): void {
    $stmt = $pdo->prepare('UPDATE sessions SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ?');
    $stmt->execute([$session_id]);
}

function record_anonymous_metric(PDO $pdo, string $name, float $value): void {
    if (!defined('ENABLE_ANONYMOUS_METRICS') || !ENABLE_ANONYMOUS_METRICS) return;
    $stmt = $pdo->prepare('INSERT INTO anonymous_metrics
        (metric_day, metric_name, sample_count, value_sum, value_max)
        VALUES (CURRENT_DATE, ?, 1, ?, ?)
        ON DUPLICATE KEY UPDATE sample_count = sample_count + 1,
            value_sum = value_sum + VALUES(value_sum),
            value_max = GREATEST(value_max, VALUES(value_max))');
    $stmt->execute([$name, $value, $value]);
}

function upsert_player(PDO $pdo, $session_id, array $player): void {
    $stmt = $pdo->prepare('INSERT INTO players (session_id, player_uid, name) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = CURRENT_TIMESTAMP');
    $stmt->execute([
        $session_id,
        (string)$player['player_id'],
        $player['name'] ?? (string)$player['player_id'],
    ]);
}

function vehicle_update_requires_leader_reconcile($saved, array $veh): bool {
    if (!$saved) return false;
    $status_changed = array_key_exists('status', $veh)
        && valid_vehicle_status($veh['status'])
        && (int)$saved['status'] !== (int)$veh['status'];
    $type_changed = array_key_exists('type', $veh) && (string)$saved['type'] !== (string)$veh['type'];
    return $status_changed || $type_changed;
}

function sql_placeholders(array $values): string {
    return implode(',', array_fill(0, count($values), '?'));
}

function upsert_vehicles(PDO $pdo, $session_id, array $vehicles, ?bool &$leaders_dirty = null, ?array &$leader_event_ids = null): array {
    $updates = [];
    foreach ($vehicles as $vehicle) {
        if (!is_array($vehicle)) continue;
        $gameId = trim((string)($vehicle['game_vehicle_id'] ?? ''));
        if ($gameId === '') continue;
        $vehicle['game_vehicle_id'] = $gameId;
        $updates[$gameId] = $vehicle;
    }
    if (!$updates) return [];

    $gameIds = array_keys($updates);
    $lookup = $pdo->prepare('SELECT * FROM vehicles WHERE session_id = ? AND game_vehicle_id IN (' . sql_placeholders($gameIds) . ')');
    $lookup->execute(array_merge([$session_id], $gameIds));
    $savedByGameId = [];
    foreach ($lookup->fetchAll() as $row) $savedByGameId[(string)$row['game_vehicle_id']] = $row;

    $upsert = $pdo->prepare('INSERT INTO vehicles (session_id, game_vehicle_id, name, type, modes, x, y, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), name = VALUES(name), type = VALUES(type),
            modes = VALUES(modes), x = VALUES(x), y = VALUES(y), status = VALUES(status), updated_at = CURRENT_TIMESTAMP');
    $history = $pdo->prepare('INSERT INTO vehicle_status_history
        (session_id, vehicle_id, game_vehicle_id, vehicle_name, status) VALUES (?, ?, ?, ?, ?)');

    $currentRows = [];
    $changedLeaderVehicleIds = [];
    $arrivedVehicleIds = [];
    $clearedVehicleIds = [];
    $returnedVehicleIds = [];
    foreach ($updates as $gameId => $vehicle) {
        $saved = $savedByGameId[$gameId] ?? false;
        $row = [
            'name' => check_options('name', $saved, $vehicle, $gameId),
            'type' => check_options('type', $saved, $vehicle, 'None'),
            'modes' => check_options('modes', $saved, $vehicle, null),
            'x' => check_options('x', $saved, $vehicle, 0),
            'y' => check_options('y', $saved, $vehicle, 0),
            'status' => check_options('status', $saved, $vehicle, 2),
        ];
        $upsert->execute([$session_id, $gameId, $row['name'], $row['type'], $row['modes'], $row['x'], $row['y'], $row['status']]);
        $vehicleId = $saved ? (int)$saved['id'] : (int)$pdo->lastInsertId();
        $current = array_merge($saved ?: [], $row, [
            'id' => $vehicleId,
            'session_id' => $session_id,
            'game_vehicle_id' => $gameId,
        ]);
        $currentRows[] = $current;

        if (vehicle_update_requires_leader_reconcile($saved, $vehicle)) {
            $leaders_dirty = true;
            $changedLeaderVehicleIds[] = $vehicleId;
        }
        if (array_key_exists('status', $vehicle) && valid_vehicle_status($vehicle['status'])) {
            $status = (int)$vehicle['status'];
            $previousStatus = $saved !== false && isset($saved['status']) ? (int)$saved['status'] : null;
            if ($previousStatus === null || $previousStatus !== $status) {
                $history->execute([$session_id, $vehicleId, $gameId, $row['name'], $status]);
            }
            if ($status === 8) $arrivedVehicleIds[] = $vehicleId;
            if (in_array($status, [1, 2], true)) $clearedVehicleIds[] = $vehicleId;
            if ($status === 2) $returnedVehicleIds[] = $vehicleId;
        }
    }

    $allVehicleIds = array_values(array_unique(array_map(static fn(array $row): int => (int)$row['id'], $currentRows)));
    $sample = $pdo->prepare('INSERT INTO vehicle_position_history (session_id, event_id, vehicle_id, x, y, status)
        SELECT a.session_id, a.event_id, v.id, v.x, v.y, v.status
        FROM assignments a
        JOIN events e ON e.id = a.event_id AND e.session_id = a.session_id AND e.status = \'active\'
        JOIN vehicles v ON v.id = a.vehicle_id AND v.session_id = a.session_id
        WHERE a.session_id = ? AND a.vehicle_id IN (' . sql_placeholders($allVehicleIds) . ')
          AND (a.last_position_sample_at IS NULL OR a.last_position_sample_at <= DATE_SUB(NOW(6), INTERVAL 10 SECOND))');
    $sample->execute(array_merge([$session_id], $allVehicleIds));
    if ($sample->rowCount() > 0) {
        $stamp = $pdo->prepare('UPDATE assignments SET last_position_sample_at = NOW(6)
            WHERE session_id = ? AND vehicle_id IN (' . sql_placeholders($allVehicleIds) . ')
              AND (last_position_sample_at IS NULL OR last_position_sample_at <= DATE_SUB(NOW(6), INTERVAL 10 SECOND))');
        $stamp->execute(array_merge([$session_id], $allVehicleIds));
    }

    if ($changedLeaderVehicleIds) {
        $ids = array_values(array_unique($changedLeaderVehicleIds));
        $affected = $pdo->prepare('SELECT DISTINCT event_id FROM assignments
            WHERE session_id = ? AND vehicle_id IN (' . sql_placeholders($ids) . ')');
        $affected->execute(array_merge([$session_id], $ids));
        $leader_event_ids = array_values(array_unique(array_merge(
            $leader_event_ids ?? [],
            array_map('intval', $affected->fetchAll(PDO::FETCH_COLUMN))
        )));
    }
    if ($arrivedVehicleIds) {
        $stmt = $pdo->prepare("UPDATE hospital_reservations SET status = 'arrived',
            arrived_at = COALESCE(arrived_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
            WHERE session_id = ? AND status = 'reserved' AND vehicle_id IN (" . sql_placeholders($arrivedVehicleIds) . ')');
        $stmt->execute(array_merge([$session_id], $arrivedVehicleIds));
    }
    if ($clearedVehicleIds) {
        $stmt = $pdo->prepare('DELETE FROM hospital_reservations WHERE session_id = ? AND vehicle_id IN (' . sql_placeholders($clearedVehicleIds) . ')');
        $stmt->execute(array_merge([$session_id], $clearedVehicleIds));
    }
    if ($returnedVehicleIds) {
        $stmt = $pdo->prepare('SELECT DISTINCT event_id FROM assignments WHERE session_id = ? AND vehicle_id IN (' . sql_placeholders($returnedVehicleIds) . ')');
        $stmt->execute(array_merge([$session_id], $returnedVehicleIds));
        $leader_event_ids = array_values(array_unique(array_merge(
            $leader_event_ids ?? [],
            array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN))
        )));
        $stmt = $pdo->prepare('DELETE FROM assignments WHERE session_id = ? AND vehicle_id IN (' . sql_placeholders($returnedVehicleIds) . ')');
        $stmt->execute(array_merge([$session_id], $returnedVehicleIds));
        if ($stmt->rowCount() > 0) $leaders_dirty = true;
    }
    return $currentRows;
}

function upsert_vehicle(PDO $pdo, $session_id, array $vehicle, ?bool &$leaders_dirty = null, ?array &$leader_event_ids = null) {
    return upsert_vehicles($pdo, $session_id, [$vehicle], $leaders_dirty, $leader_event_ids)[0] ?? false;
}

function unassign_vehicle(PDO $pdo, $session_id, $vehicle_id): int {
    $stmt = $pdo->prepare('DELETE FROM assignments WHERE session_id = ? AND vehicle_id = ?');
    $stmt->execute([$session_id, $vehicle_id]);
    return $stmt->rowCount();
}

function unassign_vehicle_from_event(PDO $pdo, $session_id, $vehicle_id, $event_id): int {
    $stmt = $pdo->prepare('DELETE FROM assignments WHERE session_id = ? AND vehicle_id = ? AND event_id = ?');
    $stmt->execute([$session_id, $vehicle_id, $event_id]);
    return $stmt->rowCount();
}

function event_leader_feedback_text(
    string $role,
    ?string $previous_vehicle,
    ?string $next_vehicle,
    bool $automatic = false
): ?string {
    if ($previous_vehicle === $next_vehicle) return null;

    $leader = $role === 'medical' ? 'Einsatzleiter RD' : 'Einsatzleiter FW';
    $mode = $automatic ? 'automatisch ' : '';
    if ($previous_vehicle === null && $next_vehicle !== null) {
        return $leader . ' ' . $mode . 'bestimmt: ' . $next_vehicle;
    }
    if ($previous_vehicle !== null && $next_vehicle === null) {
        return $leader . ' ' . $mode . 'aufgehoben: ' . $previous_vehicle;
    }
    if ($previous_vehicle !== null && $next_vehicle !== null) {
        return $leader . ' ' . $mode . 'gewechselt: ' . $previous_vehicle . ' → ' . $next_vehicle;
    }
    return null;
}

function event_leader_vehicle_label(PDO $pdo, $session_id, ?int $vehicle_id): ?string {
    if ($vehicle_id === null) return null;
    $stmt = $pdo->prepare('SELECT name, game_vehicle_id FROM vehicles WHERE session_id = ? AND id = ?');
    $stmt->execute([$session_id, $vehicle_id]);
    $vehicle = $stmt->fetch();
    if (!$vehicle) return 'Fahrzeug #' . $vehicle_id;
    $name = trim((string)($vehicle['name'] ?? ''));
    return $name !== '' ? $name : (string)$vehicle['game_vehicle_id'];
}

function record_event_leader_change(
    PDO $pdo,
    $session_id,
    int $event_id,
    string $role,
    ?int $previous_vehicle_id,
    ?int $next_vehicle_id,
    bool $automatic = false
): void {
    if ($previous_vehicle_id === $next_vehicle_id) return;
    $content = event_leader_feedback_text(
        $role,
        event_leader_vehicle_label($pdo, $session_id, $previous_vehicle_id),
        event_leader_vehicle_label($pdo, $session_id, $next_vehicle_id),
        $automatic
    );
    if ($content === null) return;
    $stmt = $pdo->prepare('INSERT INTO event_feedback (session_id, event_id, content) VALUES (?, ?, ?)');
    $stmt->execute([$session_id, $event_id, $content]);
    if ($automatic) {
        record_event_journal($pdo, $session_id, $event_id, 'system', 'leader_changed', $content);
    }
}

function record_event_journal(
    PDO $pdo,
    $session_id,
    int $event_id,
    string $source,
    string $action_type,
    string $summary,
    array $payload = []
): void {
    if (!in_array($source, ['dispatcher', 'game', 'system'], true)) $source = 'system';
    $stmt = $pdo->prepare('INSERT INTO event_journal
        (session_id, event_id, source, action_type, summary, payload) VALUES (?, ?, ?, ?, ?, ?)');
    $stmt->execute([
        $session_id,
        $event_id,
        $source,
        substr($action_type, 0, 64),
        substr($summary, 0, 1000),
        $payload ? json_encode($payload, JSON_UNESCAPED_UNICODE) : null,
    ]);
}

function record_vehicle_event_journal(
    PDO $pdo,
    $session_id,
    int $vehicle_id,
    string $action_type,
    string $summary
): void {
    $stmt = $pdo->prepare("SELECT DISTINCT a.event_id FROM assignments a
        JOIN events e ON e.id = a.event_id AND e.session_id = a.session_id AND e.status = 'active'
        WHERE a.session_id = ? AND a.vehicle_id = ?");
    $stmt->execute([$session_id, $vehicle_id]);
    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $eventId) {
        record_event_journal($pdo, $session_id, (int)$eventId, 'dispatcher', $action_type, $summary);
    }
}

function reconcile_event_leaders(PDO $pdo, $session_id, bool $record_feedback = true, ?array $event_ids = null): bool {
    $changed = false;
    $event_ids = $event_ids === null ? null : array_values(array_unique(array_filter(array_map('intval', $event_ids))));
    if ($event_ids !== null && !$event_ids) return false;
    $leaderFilter = $event_ids === null ? '' : ' AND leaders.event_id IN (' . sql_placeholders($event_ids) . ')';
    $leaderParams = $event_ids === null ? [$session_id] : array_merge([$session_id], $event_ids);
    $invalid = $pdo->prepare('SELECT leaders.event_id, leaders.role, leaders.vehicle_id, e.status AS event_status
        FROM event_leaders leaders
        LEFT JOIN assignments a ON a.session_id = leaders.session_id
            AND a.event_id = leaders.event_id AND a.vehicle_id = leaders.vehicle_id
        LEFT JOIN vehicles v ON v.session_id = leaders.session_id AND v.id = leaders.vehicle_id
        LEFT JOIN events e ON e.session_id = leaders.session_id AND e.id = leaders.event_id
        WHERE leaders.session_id = ?
          AND (a.id IS NULL OR v.status NOT IN (3, 4) OR e.status <> \'active\')' . $leaderFilter);
    $invalid->execute($leaderParams);
    $invalidLeaders = $invalid->fetchAll();

    $stmt = $pdo->prepare('DELETE leaders FROM event_leaders leaders
        LEFT JOIN assignments a ON a.session_id = leaders.session_id
            AND a.event_id = leaders.event_id AND a.vehicle_id = leaders.vehicle_id
        LEFT JOIN vehicles v ON v.session_id = leaders.session_id AND v.id = leaders.vehicle_id
        LEFT JOIN events e ON e.session_id = leaders.session_id AND e.id = leaders.event_id
        WHERE leaders.session_id = ?
          AND (a.id IS NULL OR v.status NOT IN (3, 4) OR e.status <> \'active\')' . $leaderFilter);
    $stmt->execute($leaderParams);
    $changed = $stmt->rowCount() > 0;

    $previousLeaders = ['fire' => [], 'medical' => []];
    foreach ($invalidLeaders as $leader) {
        if (($leader['event_status'] ?? null) !== 'active') continue;
        $eventId = (int)$leader['event_id'];
        $vehicleId = (int)$leader['vehicle_id'];
        $role = (string)$leader['role'];
        if (isset($previousLeaders[$role])) $previousLeaders[$role][$eventId] = $vehicleId;
    }

    $activeFilter = $event_ids === null ? '' : ' AND id IN (' . sql_placeholders($event_ids) . ')';
    $events = $pdo->prepare("SELECT id FROM events WHERE session_id = ? AND status = 'active'" . $activeFilter);
    $events->execute($event_ids === null ? [$session_id] : array_merge([$session_id], $event_ids));
    $vehicles = $pdo->prepare('SELECT v.id, v.game_vehicle_id, v.name, v.type, v.status,
            COALESCE(
                MIN(CASE WHEN h.status = 4 AND h.created_at >= a.created_at THEN h.created_at END),
                CASE WHEN v.status = 4 THEN a.created_at END
            ) AS first_status_4_at
        FROM assignments a
        JOIN vehicles v ON v.session_id = a.session_id AND v.id = a.vehicle_id
        LEFT JOIN vehicle_status_history h ON h.session_id = a.session_id AND h.vehicle_id = a.vehicle_id
        WHERE a.session_id = ? AND a.event_id = ?
        GROUP BY v.id, v.game_vehicle_id, v.name, v.type, v.status, a.created_at');
    $current = $pdo->prepare('SELECT vehicle_id, source FROM event_leaders
        WHERE session_id = ? AND event_id = ? AND role = ?');
    $clear = $pdo->prepare('DELETE FROM event_leaders
        WHERE session_id = ? AND event_id = ? AND role = ?');
    $insert = $pdo->prepare("INSERT INTO event_leaders (session_id, event_id, vehicle_id, role, source)
        VALUES (?, ?, ?, ?, 'automatic')");

    foreach ($events->fetchAll(PDO::FETCH_COLUMN) as $event_id) {
        $vehicles->execute([$session_id, $event_id]);
        $assignedVehicles = $vehicles->fetchAll();
        $candidates = [
            'fire' => select_fire_incident_leader($assignedVehicles),
            'medical' => select_medical_incident_leader($assignedVehicles),
        ];

        foreach ($candidates as $role => $candidate) {
            $current->execute([$session_id, $event_id, $role]);
            $currentLeader = $current->fetch();
            if ($currentLeader && $currentLeader['source'] === 'manual') continue;
            $selected = $currentLeader
                ? (int)$currentLeader['vehicle_id']
                : ($previousLeaders[$role][(int)$event_id] ?? null);
            if ($selected === $candidate) continue;
            $clear->execute([$session_id, $event_id, $role]);
            if ($candidate !== null) $insert->execute([$session_id, $event_id, $candidate, $role]);
            if ($record_feedback) {
                record_event_leader_change(
                    $pdo,
                    $session_id,
                    (int)$event_id,
                    $role,
                    $selected,
                    $candidate,
                    true
                );
            }
            $changed = true;
        }
    }
    return $changed;
}

function get_vehicle_by_game_id(PDO $pdo, $session_id, $game_vehicle_id) {
    $stmt = $pdo->prepare('SELECT * FROM vehicles WHERE session_id = ? AND game_vehicle_id = ?');
    $stmt->execute([$session_id, $game_vehicle_id]);
    return $stmt->fetch();
}

function upsert_hospital(PDO $pdo, $session_id, array $h): void {
    $stmt = $pdo->prepare('INSERT INTO hospitals (session_id, game_hospital_id, name, x, y, icu_available, ward_available, icu_total, ward_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name), x = VALUES(x), y = VALUES(y),
            icu_available = VALUES(icu_available), ward_available = VALUES(ward_available),
            icu_total = VALUES(icu_total), ward_total = VALUES(ward_total), updated_at = CURRENT_TIMESTAMP');
    $stmt->execute([
        $session_id, $h['game_hospital_id'], $h['name'] ?? null, $h['x'] ?? null, $h['y'] ?? null,
        $h['icu_available'] ?? null, $h['ward_available'] ?? null, $h['icu_total'] ?? null, $h['ward_total'] ?? null,
    ]);

    $stmt = $pdo->prepare('SELECT id, ward_available, icu_available FROM hospitals WHERE session_id = ? AND game_hospital_id = ?');
    $stmt->execute([$session_id, $h['game_hospital_id']]);
    $hospital = $stmt->fetch();
    if ($hospital) {
        reconcile_hospital_reservations($pdo, $session_id, (int)$hospital['id'], 'ward', (int)$hospital['ward_available']);
        reconcile_hospital_reservations($pdo, $session_id, (int)$hospital['id'], 'icu', (int)$hospital['icu_available']);
    }
}

function reconcile_hospital_reservations(PDO $pdo, $session_id, int $hospital_id, string $bed_type, int $reported_available): void {
    $stmt = $pdo->prepare("SELECT id, baseline_available FROM hospital_reservations
        WHERE session_id = ? AND hospital_id = ? AND bed_type = ? AND status = 'arrived'
        ORDER BY arrived_at ASC, id ASC");
    $stmt->execute([$session_id, $hospital_id, $bed_type]);
    $arrived = $stmt->fetchAll();
    if (!$arrived) return;

    $baseline = max(array_map(static fn(array $row): int => (int)$row['baseline_available'], $arrived));
    $confirmed = min(count($arrived), max(0, $baseline - $reported_available));
    if ($confirmed > 0) {
        $ids = array_column(array_slice($arrived, 0, $confirmed), 'id');
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $pdo->prepare("DELETE FROM hospital_reservations WHERE session_id = ? AND id IN ($placeholders)");
        $stmt->execute(array_merge([$session_id], $ids));
    }

    $status_filter = $confirmed > 0 ? '' : " AND status = 'arrived'";
    $stmt = $pdo->prepare("UPDATE hospital_reservations SET baseline_available = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND hospital_id = ? AND bed_type = ?$status_filter");
    $stmt->execute([$reported_available, $session_id, $hospital_id, $bed_type]);
}

function message_is_speech_request(array $message): bool {
    $short = (string)($message['message'] ?? '');
    $long = (string)($message['long_message'] ?? '');
    $signal = strtolower((string)preg_replace('/\s+/', '', $short));
    return stripos($short, 'sprechwunsch') !== false
        || stripos($long, 'sprechwunsch') !== false
        || in_array($signal, ['5', 's5', 'status5', 'fms5'], true);
}

function open_speech_request_occurrence_id(PDO $pdo, $session_id, string $game_vehicle_id, ?int $event_id): ?int {
    if ($game_vehicle_id === '') return null;
    $stmt = $pdo->prepare("INSERT INTO speech_request_occurrences
        (session_id, entity_id, event_id, state) VALUES (?, ?, ?, 'active')
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)");
    $stmt->execute([$session_id, $game_vehicle_id, $event_id]);
    return (int)$pdo->lastInsertId();
}

function upsert_message(PDO $pdo, $session_id, array $m) {
    $entity_id = $m['entity_id'] ?? null;
    $message = $m['message'] ?? null;
    $is_speech_request = message_is_speech_request($m);

    // Messages carrying a vehicle id inherit the event that vehicle is assigned to
    if ($entity_id !== null && $entity_id !== '') {
        $stmt = $pdo->prepare('SELECT event_id FROM assignments
            INNER JOIN vehicles ON assignments.session_id = vehicles.session_id AND vehicle_id = vehicles.id
            WHERE vehicles.session_id = ? AND game_vehicle_id = ?');
        $stmt->execute([$session_id, $entity_id]);
        $event_data = $stmt->fetch();
        if (!empty($event_data)) {
            $event_data['type'] = 'event';
        } else {
            $event_data = ['type' => 'vehicle'];
        }
    } else {
        $event_data = [];
    }

    $occurrence_id = $is_speech_request
        ? open_speech_request_occurrence_id(
            $pdo,
            $session_id,
            (string)($entity_id ?? ''),
            isset($event_data['event_id']) ? (int)$event_data['event_id'] : null,
        )
        : 0;

    if ($entity_id !== null && $message !== null && $occurrence_id !== null) {
        $stmt = $pdo->prepare('SELECT * FROM activity_logs
            WHERE session_id = ? AND entity_id = ? AND message = ? AND occurrence_id = ?');
        $stmt->execute([$session_id, $entity_id, $message, $occurrence_id]);
        $saved = $stmt->fetch();
    } else {
        $saved = [];
    }

    $state = $is_speech_request ? 'active' : check_options('state', $saved, $m, 'active');
    $acknowledged = 0;
    if ($is_speech_request && $occurrence_id > 0) {
        $stmt = $pdo->prepare('SELECT COALESCE(MAX(acknowledged), 0) FROM activity_logs
            WHERE session_id = ? AND occurrence_id = ?');
        $stmt->execute([$session_id, $occurrence_id]);
        $acknowledged = (int)$stmt->fetchColumn();
    }

    $stmt = $pdo->prepare('INSERT INTO activity_logs
        (session_id, type, entity_id, event_id, message, occurrence_id, long_message, meta, state, acknowledged)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            updated_at = IF(
                NOT (event_id <=> VALUES(event_id))
                OR NOT (type <=> VALUES(type))
                OR NOT (long_message <=> VALUES(long_message))
                OR NOT (meta <=> VALUES(meta))
                OR NOT (state <=> VALUES(state)),
                CURRENT_TIMESTAMP(6), updated_at
            ),
            event_id = VALUES(event_id), type = VALUES(type), long_message = VALUES(long_message),
            meta = VALUES(meta), state = VALUES(state), acknowledged = GREATEST(acknowledged, VALUES(acknowledged)),
            id = LAST_INSERT_ID(id)');
    $stmt->execute([
        $session_id,
        check_options('type', $event_data, $m, 'global'),
        check_options('entity_id', $saved, $m, null),
        check_options('event_id', $event_data, $m, null),
        check_options('message', $saved, $m, null),
        $occurrence_id,
        check_options('long_message', $saved, $m, $message),
        json_encode($m),
        $state,
        $acknowledged,
    ]);

    $stmt = $pdo->prepare('SELECT * FROM activity_logs WHERE id = ? AND session_id = ?');
    $stmt->execute([(int)$pdo->lastInsertId(), $session_id]);
    return $stmt->fetch();
}

function event_update_requires_leader_reconcile($saved, array $event): bool {
    if (!$saved || !array_key_exists('status', $event)) return false;
    return (string)$saved['status'] !== (string)$event['status'];
}

function upsert_event(PDO $pdo, $session_id, array $e, ?bool &$leaders_dirty = null) {
    if (($e['created_by'] ?? null) === 'game' && isset($e['name']) && is_string($e['name'])) {
        $e['name'] = em4_display_text($e['name']);
    }

    if (isset($e['id'])) {
        $stmt = $pdo->prepare('SELECT * FROM events WHERE session_id = ? AND id = ?');
        $stmt->execute([$session_id, $e['id']]);
        $saved = $stmt->fetch();
    } elseif (isset($e['game_event_id'])) {
        $stmt = $pdo->prepare('SELECT * FROM events WHERE session_id = ? AND game_event_id = ?');
        $stmt->execute([$session_id, $e['game_event_id']]);
        $saved = $stmt->fetch();
    } else {
        $saved = [];
    }
    if (event_update_requires_leader_reconcile($saved, $e)) $leaders_dirty = true;

    if (isset($e['id'])) {
        // Update by primary key never trips the unique key, so ON DUPLICATE won't fire
        $stmt = $pdo->prepare('UPDATE events
            SET name = ?, game_event_id = ?, x = ?, y = ?, status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?');
        $stmt->execute([
            check_options('name', $saved, $e, null),
            check_options('game_event_id', $saved, $e, null),
            check_options('x', $saved, $e, null),
            check_options('y', $saved, $e, null),
            check_options('status', $saved, $e, 'active'),
            $e['id'],
        ]);
    } else {
        $stmt = $pdo->prepare('INSERT INTO events (session_id, game_event_id, name, x, y, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE name = VALUES(name), game_event_id = VALUES(game_event_id), x = VALUES(x),
                y = VALUES(y), status = VALUES(status), updated_at = CURRENT_TIMESTAMP');
        $stmt->execute([
            $session_id,
            check_options('game_event_id', $saved, $e, null),
            check_options('name', $saved, $e, null),
            check_options('x', $saved, $e, null),
            check_options('y', $saved, $e, null),
            check_options('status', $saved, $e, 'active'),
            check_options('created_by', $saved, $e, 'game'),
        ]);
    }

    $isNew = !$saved;
    if (isset($e['game_event_id'])) {
        $stmt = $pdo->prepare('SELECT * FROM events WHERE session_id = ? AND game_event_id = ?');
        $stmt->execute([$session_id, $e['game_event_id']]);
        $event = $stmt->fetch();
        if ($isNew && $event) record_anonymous_metric($pdo, 'events_created', 1.0);
        return $event;
    }
    $stmt = $pdo->prepare('SELECT * FROM events WHERE id = ?');
    $stmt->execute([$e['id'] ?? $pdo->lastInsertId()]);
    $event = $stmt->fetch();
    if ($isNew && $event) record_anonymous_metric($pdo, 'events_created', 1.0);
    return $event;
}

function upsert_note(PDO $pdo, $session_id, array $n) {
    $stmt = $pdo->prepare('INSERT INTO notes (session_id, event_id, content)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE content = VALUES(content), updated_at = CURRENT_TIMESTAMP');
    $stmt->execute([$session_id, $n['event_id'], $n['content'] ?? '']);

    $stmt = $pdo->prepare('SELECT * FROM notes WHERE session_id = ? AND event_id = ?');
    $stmt->execute([$session_id, $n['event_id']]);
    return $stmt->fetch();
}

function em4_safe_text(string $text): string {
    $text = strtr($text, [
        'Ä' => 'Ae',
        'Ö' => 'Oe',
        'Ü' => 'Ue',
        'ä' => 'ae',
        'ö' => 'oe',
        'ü' => 'ue',
        'ẞ' => 'SS',
        'ß' => 'ss',
    ]);

    if (function_exists('iconv')) {
        $converted = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text);
        if ($converted !== false) {
            $text = $converted;
        }
    }

    return preg_replace('/[^\x20-\x7E]/', '', $text) ?? $text;
}

function em4_display_text(string $text): string {
    $text = strtr($text, [
        'AE' => 'Ä',
        'Ae' => 'Ä',
        'ae' => 'ä',
        'OE' => 'Ö',
        'Oe' => 'Ö',
        'oe' => 'ö',
    ]);

    // Bei echten Vokalfolgen wie Feuer, Neue, Bauer oder Quelle bleibt "ue" erhalten.
    $text = preg_replace('/(?<![AEIOUaeiouQq])UE/u', 'Ü', $text) ?? $text;
    $text = preg_replace('/(?<![AEIOUaeiouQq])Ue/u', 'Ü', $text) ?? $text;
    return preg_replace('/(?<![AEIOUaeiouQq])ue/u', 'ü', $text) ?? $text;
}

function insert_command(PDO $pdo, $session_id, string $type, array $payload): int {
    $stmt = $pdo->prepare('INSERT INTO commands (session_id, type, payload) VALUES (?, ?, ?)');
    $stmt->execute([$session_id, $type, json_encode($payload, JSON_UNESCAPED_UNICODE)]);
    return (int)$pdo->lastInsertId();
}

function insert_alarm_history(PDO $pdo, $session_id, int $command_id, array $event, array $vehicle, ?array $player, ?string $mode): void {
    $stmt = $pdo->prepare('INSERT IGNORE INTO alarm_history
        (session_id, command_id, event_id, event_name, vehicle_id, game_vehicle_id, vehicle_name,
         assigned_player_id, player_name, mode, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, created_at FROM commands WHERE id = ? AND session_id = ?');
    $stmt->execute([
        $session_id,
        $command_id,
        $event['id'] ?? null,
        $event['name'] ?? null,
        $vehicle['id'] ?? null,
        (string)$vehicle['game_vehicle_id'],
        $vehicle['name'] ?? $vehicle['type'] ?? $vehicle['game_vehicle_id'],
        $player['id'] ?? null,
        $player['name'] ?? null,
        $mode,
        $command_id,
        $session_id,
    ]);
}

function backfill_alarm_history(PDO $pdo, $session_id): void {
    $stmt = $pdo->prepare("SELECT c.id, c.payload, c.created_at
        FROM commands c
        LEFT JOIN alarm_history h ON h.command_id = c.id
        WHERE c.session_id = ? AND c.type = 'assign' AND h.id IS NULL
        ORDER BY c.id ASC");
    $stmt->execute([$session_id]);
    $insert = $pdo->prepare('INSERT IGNORE INTO alarm_history
        (session_id, command_id, event_id, event_name, vehicle_id, game_vehicle_id, vehicle_name,
         assigned_player_id, player_name, mode, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    foreach ($stmt->fetchAll() as $command) {
        $payload = is_array($command['payload']) ? $command['payload'] : json_decode((string)$command['payload'], true);
        if (!is_array($payload)) continue;
        $event_id = isset($payload['event_id']) && (int)$payload['event_id'] > 0 ? (int)$payload['event_id'] : null;
        $game_id = (string)($payload['game_vehicle_id'] ?? '');
        if ($game_id === '') continue;

        $event = null;
        if ($event_id !== null) {
            $lookup = $pdo->prepare('SELECT name FROM events WHERE session_id = ? AND id = ?');
            $lookup->execute([$session_id, $event_id]);
            $event = $lookup->fetch();
        }
        $lookup = $pdo->prepare('SELECT id, name, type FROM vehicles WHERE session_id = ? AND game_vehicle_id = ?');
        $lookup->execute([$session_id, $game_id]);
        $vehicle = $lookup->fetch() ?: [];
        $insert->execute([
            $session_id, $command['id'], $event_id, $event['name'] ?? null,
            $vehicle['id'] ?? null, $game_id, $vehicle['name'] ?? $vehicle['type'] ?? $game_id,
            null, null, $payload['mode'] ?? null, $command['created_at'],
        ]);
    }
}
