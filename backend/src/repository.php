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
    $stmt = $pdo->prepare('UPDATE sessions SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
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

function upsert_vehicle(PDO $pdo, $session_id, array $veh) {
    $stmt = $pdo->prepare('SELECT * FROM vehicles WHERE session_id = ? AND game_vehicle_id = ?');
    $stmt->execute([$session_id, $veh['game_vehicle_id']]);
    $saved = $stmt->fetch();

    $stmt = $pdo->prepare('INSERT INTO vehicles (session_id, game_vehicle_id, name, type, modes, x, y, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name), type = VALUES(type), modes = VALUES(modes),
            x = VALUES(x), y = VALUES(y), status = VALUES(status), updated_at = CURRENT_TIMESTAMP');
    $stmt->execute([
        $session_id,
        $veh['game_vehicle_id'],
        check_options('name', $saved, $veh, $veh['game_vehicle_id']),
        check_options('type', $saved, $veh, 'None'),
        check_options('modes', $saved, $veh, null),
        check_options('x', $saved, $veh, 0),
        check_options('y', $saved, $veh, 0),
        check_options('status', $saved, $veh, 2),
    ]);

    $current = get_vehicle_by_game_id($pdo, $session_id, $veh['game_vehicle_id']);

    if ($current && array_key_exists('status', $veh) && valid_vehicle_status($veh['status'])) {
        $status = (int)$veh['status'];
        $previous_status = $saved !== false && isset($saved['status']) ? (int)$saved['status'] : null;
        if ($previous_status === null || $previous_status !== $status) {
            $stmt = $pdo->prepare('INSERT INTO vehicle_status_history
                (session_id, vehicle_id, game_vehicle_id, vehicle_name, status)
                VALUES (?, ?, ?, ?, ?)');
            $stmt->execute([
                $session_id,
                $current['id'],
                $current['game_vehicle_id'],
                $current['name'],
                $status,
            ]);
        }
    }

    if (isset($veh['status']) && $current) {
        $status = (int)$veh['status'];
        if ($status === 8) {
            $stmt = $pdo->prepare("UPDATE hospital_reservations
                SET status = 'arrived', arrived_at = COALESCE(arrived_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
                WHERE session_id = ? AND vehicle_id = ? AND status = 'reserved'");
            $stmt->execute([$session_id, $current['id']]);
        } elseif (in_array($status, [1, 2], true)) {
            $stmt = $pdo->prepare("DELETE FROM hospital_reservations
                WHERE session_id = ? AND vehicle_id = ?");
            $stmt->execute([$session_id, $current['id']]);
        }
    }

    // Status 2 = back at station, drop any assignment
    if (isset($veh['status']) && $veh['status'] == 2 && isset($saved['id'])) {
        unassign_vehicle($pdo, $session_id, $saved['id']);
    }

    return $current;
}

function unassign_vehicle(PDO $pdo, $session_id, $vehicle_id): int {
    $stmt = $pdo->prepare('DELETE FROM assignments WHERE session_id = ? AND vehicle_id = ?');
    $stmt->execute([$session_id, $vehicle_id]);
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
}

function reconcile_event_leaders(PDO $pdo, $session_id, bool $record_feedback = true): bool {
    $changed = false;
    $invalid = $pdo->prepare('SELECT leaders.event_id, leaders.role, leaders.vehicle_id, e.status AS event_status
        FROM event_leaders leaders
        LEFT JOIN assignments a ON a.session_id = leaders.session_id
            AND a.event_id = leaders.event_id AND a.vehicle_id = leaders.vehicle_id
        LEFT JOIN vehicles v ON v.session_id = leaders.session_id AND v.id = leaders.vehicle_id
        LEFT JOIN events e ON e.session_id = leaders.session_id AND e.id = leaders.event_id
        WHERE leaders.session_id = ?
          AND (a.id IS NULL OR v.status NOT IN (3, 4) OR e.status <> \'active\')');
    $invalid->execute([$session_id]);
    $invalidLeaders = $invalid->fetchAll();

    $stmt = $pdo->prepare('DELETE leaders FROM event_leaders leaders
        LEFT JOIN assignments a ON a.session_id = leaders.session_id
            AND a.event_id = leaders.event_id AND a.vehicle_id = leaders.vehicle_id
        LEFT JOIN vehicles v ON v.session_id = leaders.session_id AND v.id = leaders.vehicle_id
        LEFT JOIN events e ON e.session_id = leaders.session_id AND e.id = leaders.event_id
        WHERE leaders.session_id = ?
          AND (a.id IS NULL OR v.status NOT IN (3, 4) OR e.status <> \'active\')');
    $stmt->execute([$session_id]);
    $changed = $stmt->rowCount() > 0;

    $previousMedical = [];
    foreach ($invalidLeaders as $leader) {
        if (($leader['event_status'] ?? null) !== 'active') continue;
        $eventId = (int)$leader['event_id'];
        $vehicleId = (int)$leader['vehicle_id'];
        if ($leader['role'] === 'medical') {
            $previousMedical[$eventId] = $vehicleId;
        } elseif ($record_feedback) {
            record_event_leader_change($pdo, $session_id, $eventId, 'fire', $vehicleId, null);
        }
    }

    $events = $pdo->prepare("SELECT id FROM events WHERE session_id = ? AND status = 'active'");
    $events->execute([$session_id]);
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
    $current = $pdo->prepare("SELECT vehicle_id, source FROM event_leaders
        WHERE session_id = ? AND event_id = ? AND role = 'medical'");
    $clear = $pdo->prepare("DELETE FROM event_leaders
        WHERE session_id = ? AND event_id = ? AND role = 'medical'");
    $insert = $pdo->prepare("INSERT INTO event_leaders (session_id, event_id, vehicle_id, role, source)
        VALUES (?, ?, ?, 'medical', 'automatic')");

    foreach ($events->fetchAll(PDO::FETCH_COLUMN) as $event_id) {
        $current->execute([$session_id, $event_id]);
        $currentLeader = $current->fetch();
        if ($currentLeader && $currentLeader['source'] === 'manual') continue;
        $selected = $currentLeader
            ? (int)$currentLeader['vehicle_id']
            : ($previousMedical[(int)$event_id] ?? null);
        $vehicles->execute([$session_id, $event_id]);
        $candidate = select_medical_incident_leader($vehicles->fetchAll());
        if ($selected === $candidate) continue;
        $clear->execute([$session_id, $event_id]);
        if ($candidate !== null) $insert->execute([$session_id, $event_id, $candidate]);
        if ($record_feedback) {
            record_event_leader_change(
                $pdo,
                $session_id,
                (int)$event_id,
                'medical',
                $selected,
                $candidate,
                true
            );
        }
        $changed = true;
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

function upsert_event(PDO $pdo, $session_id, array $e) {
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
