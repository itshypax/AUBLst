<?php
declare(strict_types=1);

function action_update_events(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null);
    $sid = $session['id'];

    foreach (($data['updates'] ?? []) as $e) {
        $e['created_by'] = 'game';
        upsert_event($pdo, $sid, $e);
    }
    respond_json(200, ['ok' => true]);
}

function action_events_create(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null, $data['pin'] ?? null, true);
    $sid = $session['id'];

    $event = upsert_event($pdo, $sid, [
        'name' => $data['name'] ?? 'Event',
        'x' => n($data['x'] ?? 0),
        'y' => n($data['y'] ?? 0),
        'status' => 'active',
        'created_by' => 'frontend',
    ]);

    insert_command($pdo, $sid, 'event_create', [
        'event_id' => (int)$event['id'],
        'name' => em4_safe_text((string)($data['name'] ?? 'Event')),
        'target' => ['x' => (float)$data['x'], 'y' => (float)$data['y']],
    ]);

    respond_json(200, ['ok' => true, 'event' => $event]);
}

function action_events_finish(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null, $data['pin'] ?? null, true);
    $sid = $session['id'];

    $event_id = $data['event_id'] ?? null;
    if (!$event_id) respond_json(400, ['error' => 'Missing event_id']);

    $stmt = $pdo->prepare('SELECT * FROM events WHERE id = ? AND session_id = ?');
    $stmt->execute([$event_id, $sid]);
    $ev = $stmt->fetch();
    if (!$ev) respond_json(404, ['error' => 'Event not found']);
    if ($ev['created_by'] !== 'frontend') respond_json(403, ['error' => 'Only frontend-created events can be finished here']);

    $stmt = $pdo->prepare("UPDATE events SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_id = ?");
    $stmt->execute([$event_id, $sid]);

    insert_command($pdo, $sid, 'event_delete', [
        'event_id' => (int)$event_id,
        'event_game_id' => (int)$ev['game_event_id'],
    ]);

    respond_json(200, ['ok' => true]);
}

function action_events_assign(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null, $data['pin'] ?? null, true);
    $sid = $session['id'];

    $event_id = $data['event_id'] ?? null;
    if (!$event_id) respond_json(400, ['error' => 'Missing event_id']);
    $stmt = $pdo->prepare('SELECT * FROM events WHERE id = ? AND session_id = ?');
    $stmt->execute([$event_id, $sid]);
    $event = $stmt->fetch();
    if (!$event) respond_json(404, ['error' => 'Event not found']);

    $vehicle_ids = $data['vehicle_ids'] ?? [];
    if (!is_array($vehicle_ids) || count($vehicle_ids) === 0) {
        respond_json(400, ['error' => 'Keine Fahrzeuge ausgewählt.']);
    }
    $vehicle_ids = array_values(array_unique(array_map('intval', $vehicle_ids)));
    $player_id = $data['player_id'] ?? null;
    $game_player_id = null;
    $player = null;
    $modes = $data['modes'] ?? null;

    $is_frontend_event = $event['created_by'] === 'frontend';
    $has_game_event = $event['game_event_id'] !== null && trim((string)$event['game_event_id']) !== '';
    if ($is_frontend_event && !$has_game_event) {
        respond_json(409, [
            'error' => 'Der Leitstellen-Einsatz wurde vom Spiel noch nicht übernommen. Bitte kurz warten und erneut versuchen.',
        ]);
    }
    if ($player_id) {
        $stmt = $pdo->prepare('SELECT id, player_uid, name FROM players WHERE id = ? AND session_id = ?');
        $stmt->execute([$player_id, $sid]);
        $player = $stmt->fetch();
        if (!$player) {
            respond_json(400, [
                'error' => 'Der ausgewählte Spieler ist nicht mehr verfügbar. Lade die Ansicht neu und wähle ihn erneut.',
            ]);
        }
        $game_player_id = $player['player_uid'];
    }

    $pdo->beginTransaction();
    $placeholders = implode(',', array_fill(0, count($vehicle_ids), '?'));
    $stmt = $pdo->prepare("SELECT id, game_vehicle_id, name, type, status FROM vehicles
        WHERE session_id = ? AND id IN ($placeholders) FOR UPDATE");
    $stmt->execute(array_merge([$sid], $vehicle_ids));
    $vehicles_by_id = [];
    foreach ($stmt->fetchAll() as $vehicle) {
        $vehicles_by_id[(int)$vehicle['id']] = $vehicle;
    }

    $unavailable = [];
    $untracked_unit_ids = ['ASF', 'BSW', 'JA', 'FUSTW', 'TD'];
    foreach ($vehicle_ids as $vid) {
        $vehicle = $vehicles_by_id[$vid] ?? null;
        if (!$vehicle) {
            $unavailable[] = "Fahrzeug #$vid";
            continue;
        }
        $game_vehicle_id = strtoupper((string)($vehicle['game_vehicle_id'] ?? ''));
        $vehicle_type = strtoupper((string)($vehicle['type'] ?? ''));
        $is_untracked_unit = in_array($game_vehicle_id, $untracked_unit_ids, true)
            || in_array($vehicle_type, $untracked_unit_ids, true);
        if (!$is_untracked_unit && !in_array((int)$vehicle['status'], [1, 2], true)) {
            $unavailable[] = $vehicle['name'] ?? $vehicle['game_vehicle_id'] ?? "Fahrzeug #$vid";
        }
    }
    if ($unavailable) {
        $pdo->rollBack();
        respond_json(409, [
            'error' => implode(', ', $unavailable) . (count($unavailable) === 1
                ? ' ist inzwischen alarmiert oder nicht mehr verfügbar.'
                : ' sind inzwischen alarmiert oder nicht mehr verfügbar.'),
        ]);
    }

    foreach ($vehicle_ids as $vid) {
        $veh = $vehicles_by_id[$vid];
        unassign_vehicle($pdo, $sid, $vid);

        $stmt = $pdo->prepare('INSERT INTO assignments (session_id, event_id, vehicle_id, assigned_player_id, status)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE assigned_player_id = VALUES(assigned_player_id), status = VALUES(status), updated_at = CURRENT_TIMESTAMP');
        $stmt->execute([$sid, $event_id, $vid, $player_id, 'enroute']);

        $payload = [
            'event_id' => (int)$event_id,
            'event_game_id' => $event['game_event_id'] ?? null,
            'vehicle_id' => (int)$vid,
            'game_vehicle_id' => $veh['game_vehicle_id'],
            'target' => ['x' => (float)$event['x'], 'y' => (float)$event['y']],
            'assign_to_player_id' => $game_player_id !== null ? (string)$game_player_id : null,
        ];
        if (isset($modes[$vid])) {
            $payload['mode'] = $modes[$vid];
        }
        $command_id = insert_command($pdo, $sid, 'assign', $payload);
        insert_alarm_history($pdo, $sid, $command_id, $event, $veh, $player ?: null, isset($modes[$vid]) ? (string)$modes[$vid] : null);

        if ($player_id) {
            $stmt = $pdo->prepare('UPDATE vehicles SET assigned_player_id = ? WHERE id = ? AND session_id = ?');
            $stmt->execute([$player_id, $vid, $sid]);
        }
    }
    $pdo->commit();

    respond_json(200, ['ok' => true]);
}

function action_events_get_vehicles(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null);
    $sid = $session['id'];

    $event_id = $data['event_id'] ?? null;
    if (!$event_id) respond_json(400, ['error' => 'Missing event_id']);

    $stmt = $pdo->prepare('SELECT vehicles.id, name, game_vehicle_id, vehicles.status as status FROM assignments
        JOIN vehicles ON vehicles.session_id = assignments.session_id AND vehicles.id = assignments.vehicle_id
        WHERE assignments.event_id = ? AND assignments.session_id = ?');
    $stmt->execute([$event_id, $sid]);
    respond_json(200, ['ok' => true, 'vehicles' => $stmt->fetchAll()]);
}

function action_events_unassign(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null, $data['pin'] ?? null, true);
    $sid = $session['id'];

    $vehicle_ids = $data['vehicle_ids'] ?? [];
    if (!is_array($vehicle_ids) || count($vehicle_ids) === 0) {
        respond_json(400, ['error' => 'Missing vehicle_ids']);
    }

    $vehLookup = $pdo->prepare('SELECT id, game_vehicle_id FROM vehicles WHERE id = ? AND session_id = ?');

    $pdo->beginTransaction();
    foreach ($vehicle_ids as $vid) {
        $vehLookup->execute([$vid, $sid]);
        $veh = $vehLookup->fetch();
        if (!$veh) {
            continue;
        }
        unassign_vehicle($pdo, $sid, $vid);
        insert_command($pdo, $sid, 'unassign', [
            'event_id' => -1,
            'vehicle_id' => (int)$vid,
            'game_vehicle_id' => $veh['game_vehicle_id'],
            'assign_to_player_id' => null,
        ]);
    }
    $pdo->commit();

    respond_json(200, ['ok' => true]);
}

function action_events_get_logs(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null);
    $sid = $session['id'];

    $event_id = $data['event_id'] ?? null;
    if (!$event_id) respond_json(400, ['error' => 'Missing event_id']);

    $stmt = $pdo->prepare('SELECT * FROM activity_logs WHERE session_id = ? AND event_id = ?
        ORDER BY updated_at ASC, id ASC LIMIT 100');
    $stmt->execute([$sid, $event_id]);
    respond_json(200, ['logs' => $stmt->fetchAll()]);
}

function action_events_get_note(PDO $pdo): void {
    $data = get_json_input();
    $token = $data['session_token'] ?? null;
    $event_id = $data['event_id'] ?? null;
    $session = require_session($pdo, $token);
    $sid = $session['id'];

    if (!$token || !$event_id) {
        respond_json(400, ['error' => 'session_token, event_id needed']);
    }
    $stmt = $pdo->prepare('SELECT * FROM notes WHERE session_id = ? AND event_id = ?');
    $stmt->execute([$sid, $event_id]);
    respond_json(200, ['notes' => $stmt->fetchAll()]);
}

function action_events_set_note(PDO $pdo): void {
    $data = get_json_input();
    $token = $data['session_token'] ?? null;
    $event_id = $data['event_id'] ?? null;
    $content = $data['content'] ?? null;
    if (!$token || !$event_id || !array_key_exists('content', $data)) {
        respond_json(400, ['error' => 'session_token, event_id, content needed']);
    }
    $session = require_session($pdo, $token, $data['pin'] ?? null, true);
    $sid = $session['id'];

    $note = upsert_note($pdo, $sid, $data);
    respond_json(200, ['ok' => true, 'note' => $note]);
}

function action_events_archive(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null);
    $sid = $session['id'];
    backfill_alarm_history($pdo, $sid);

    $stmt = $pdo->prepare('SELECT e.*,
        (SELECT COUNT(*) FROM alarm_history h WHERE h.session_id = e.session_id AND h.event_id = e.id) AS dispatch_count,
        (SELECT COUNT(*) FROM activity_logs l WHERE l.session_id = e.session_id AND l.event_id = e.id) AS log_count,
        EXISTS(SELECT 1 FROM notes n WHERE n.session_id = e.session_id AND n.event_id = e.id AND n.content <> \'\') AS has_note
        FROM events e WHERE e.session_id = ? ORDER BY e.created_at DESC, e.id DESC LIMIT 500');
    $stmt->execute([$sid]);
    respond_json(200, ['events' => $stmt->fetchAll()]);
}

function action_event_record(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null);
    $sid = $session['id'];
    $event_id = (int)($data['event_id'] ?? 0);
    if (!$event_id) respond_json(400, ['error' => 'Missing event_id']);
    backfill_alarm_history($pdo, $sid);

    $stmt = $pdo->prepare('SELECT * FROM events WHERE session_id = ? AND id = ?');
    $stmt->execute([$sid, $event_id]);
    $event = $stmt->fetch();
    if (!$event) respond_json(404, ['error' => 'Event not found']);

    $stmt = $pdo->prepare('SELECT id, event_id, event_name, vehicle_id, game_vehicle_id, vehicle_name,
        assigned_player_id, player_name, mode, created_at
        FROM alarm_history WHERE session_id = ? AND event_id = ? ORDER BY created_at ASC, id ASC');
    $stmt->execute([$sid, $event_id]);
    $alarms = $stmt->fetchAll();

    $stmt = $pdo->prepare('SELECT id, type, entity_id, message, long_message, state, created_at, updated_at
        FROM activity_logs WHERE session_id = ? AND event_id = ? ORDER BY updated_at ASC, id ASC');
    $stmt->execute([$sid, $event_id]);
    $logs = $stmt->fetchAll();

    $stmt = $pdo->prepare('SELECT id, content, created_at, updated_at FROM notes WHERE session_id = ? AND event_id = ?');
    $stmt->execute([$sid, $event_id]);
    $note = $stmt->fetch() ?: null;

    respond_json(200, ['event' => $event, 'alarms' => $alarms, 'logs' => $logs, 'note' => $note]);
}
