<?php
declare(strict_types=1);

function action_session_create(PDO $pdo): void {
    $data = get_json_input();
    $pin = isset($data['pin']) ? trim((string)$data['pin']) : null;
    if (REQUIRE_SESSION_PIN && !$pin) {
        respond_json(400, ['error' => 'Für neue Sitzungen ist ein PIN erforderlich.']);
    }
    $session = create_session($pdo, $data['mod_id'] ?? null, $pin ?: null, $data['map_bounds'] ?? null);
    respond_json(200, [
        'ok' => true,
        'session_id' => (int)$session['id'],
        'session_token' => $session['token'],
        'mod_id' => $session['mod_id'],
        'map_bounds' => [
            'min_x' => (float)$session['min_x'],
            'min_y' => (float)$session['min_y'],
            'max_x' => (float)$session['max_x'],
            'max_y' => (float)$session['max_y'],
        ],
    ]);
}

function action_session_validate(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null, $data['pin'] ?? null, true);
    respond_json(200, ['ok' => true, 'session_token' => $session['token']]);
}

function action_session_monitor_hospital_capacity_set(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null, $data['pin'] ?? null, true);
    $enabled = $data['enabled'] ?? null;
    if (!is_bool($enabled) && !in_array($enabled, [0, 1, '0', '1'], true)) {
        respond_json(400, ['error' => 'Ungültige Einstellung für den Alarmmonitor.']);
    }

    $stmt = $pdo->prepare('UPDATE sessions SET monitor_show_hospital_capacity = ? WHERE id = ?');
    $stmt->execute([(int)(bool)$enabled, $session['id']]);
    touch_session($pdo, $session['id']);
    respond_json(200, ['ok' => true, 'enabled' => (bool)$enabled]);
}

function action_session_statistics(PDO $pdo): void {
    $session = require_session($pdo, request_value('session_token'));
    $sid = $session['id'];

    $stmt = $pdo->prepare('SELECT id, name, x, y, status, created_by, created_at, updated_at
        FROM events WHERE session_id = ? ORDER BY created_at ASC, id ASC');
    $stmt->execute([$sid]);
    $events = $stmt->fetchAll();

    backfill_alarm_history($pdo, $sid);
    $stmt = $pdo->prepare('SELECT event_id, game_vehicle_id, vehicle_name, mode, created_at
        FROM alarm_history WHERE session_id = ? ORDER BY created_at ASC, id ASC');
    $stmt->execute([$sid]);
    $dispatches = $stmt->fetchAll();

    $stmt = $pdo->prepare('SELECT game_vehicle_id, vehicle_name, status, created_at
        FROM vehicle_status_history WHERE session_id = ? ORDER BY created_at ASC, id ASC');
    $stmt->execute([$sid]);
    $status_history = $stmt->fetchAll();

    $stmt = $pdo->prepare('SELECT COUNT(*) FROM activity_logs WHERE session_id = ?');
    $stmt->execute([$sid]);
    $log_count = (int)$stmt->fetchColumn();
    $generated_at = (string)$pdo->query('SELECT NOW()')->fetchColumn();

    respond_json(200, [
        'session' => [
            'token' => $session['token'],
            'mod_id' => $session['mod_id'],
            'map_bounds' => [
                'min_x' => (float)$session['min_x'],
                'min_y' => (float)$session['min_y'],
                'max_x' => (float)$session['max_x'],
                'max_y' => (float)$session['max_y'],
            ],
            'created_at' => $session['created_at'],
            'generated_at' => $generated_at,
        ],
        'events' => $events,
        'dispatches' => $dispatches,
        'status_history' => $status_history,
        'log_count' => $log_count,
    ]);
}

function action_sync(PDO $pdo): void {
    $data = get_json_input();
    $token = $data['session_token'] ?? null;
    if (!$token) respond_json(400, ['error' => 'Missing session_token']);

    $pin = isset($data['pin']) ? trim((string)$data['pin']) : null;
    if (REQUIRE_SESSION_PIN && !$pin) {
        $stmt = $pdo->prepare('SELECT id FROM sessions WHERE token = ?');
        $stmt->execute([$token]);
        if (!$stmt->fetchColumn()) {
            respond_json(400, ['error' => 'Für die erste Synchronisierung einer Sitzung ist ein PIN erforderlich.']);
        }
    }

    $mod_id = $data['mod_id'] ?? null;

    $pdo->beginTransaction();
    ensure_mod_row($pdo, $mod_id);

    // mod_id is fixed for the lifetime of a session, IFNULL keeps the first value
    $bounds = $data['map_bounds'] ?? null;
    if ($bounds) {
        $stmt = $pdo->prepare('INSERT INTO sessions (token, mod_id, pin, min_x, min_y, max_x, max_y)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                min_x = VALUES(min_x),
                min_y = VALUES(min_y),
                max_x = VALUES(max_x),
                max_y = VALUES(max_y),
                updated_at = CURRENT_TIMESTAMP,
                mod_id = IFNULL(mod_id, VALUES(mod_id)),
                pin = IFNULL(pin, VALUES(pin))');
        $stmt->execute([
            $token, $mod_id, $pin,
            n($bounds['min_x'] ?? 0), n($bounds['min_y'] ?? 0),
            n($bounds['max_x'] ?? 1000), n($bounds['max_y'] ?? 1000),
        ]);
    } else {
        $stmt = $pdo->prepare('INSERT INTO sessions (token, mod_id, pin)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
                updated_at = CURRENT_TIMESTAMP,
                mod_id = IFNULL(mod_id, VALUES(mod_id)),
                pin = IFNULL(pin, VALUES(pin))');
        $stmt->execute([$token, $mod_id, $pin]);
    }

    $stmt = $pdo->prepare('SELECT * FROM sessions WHERE token = ?');
    $stmt->execute([$token]);
    $session = $stmt->fetch();
    $sid = $session['id'];

    if (array_key_exists('players', $data)) {
        $player_uids = [];
        foreach (($data['players'] ?? []) as $uid => $player) {
            if (is_array($player)) {
                $player_uid = (string)($player['player_id'] ?? $player['player_uid'] ?? $uid);
                $player_name = (string)($player['name'] ?? $player_uid);
            } else {
                // Der Adapter liefert ein Objekt im Format { "0": "Name", "1": "Name" }.
                $player_uid = (string)$uid;
                $player_name = (string)$player;
            }
            upsert_player($pdo, $sid, ['player_id' => $player_uid, 'name' => $player_name]);
            $player_uids[] = $player_uid;
        }

        // Alte, fehlerhaft als Spieler-ID gespeicherte Namen verschwinden beim
        // nächsten Spielerabgleich. Fremdschlüssel werden dabei auf NULL gesetzt.
        if ($player_uids) {
            $placeholders = implode(',', array_fill(0, count($player_uids), '?'));
            $stmt = $pdo->prepare("DELETE FROM players WHERE session_id = ? AND player_uid NOT IN ($placeholders)");
            $stmt->execute(array_merge([$sid], $player_uids));
        } else {
            $stmt = $pdo->prepare('DELETE FROM players WHERE session_id = ?');
            $stmt->execute([$sid]);
        }
    }
    $leaders_dirty = false;
    $leader_event_ids = [];
    upsert_vehicles($pdo, $sid, $data['vehicles'] ?? [], $leaders_dirty, $leader_event_ids);
    foreach (($data['hospitals'] ?? []) as $h) { upsert_hospital($pdo, $sid, $h); }
    foreach (($data['messages'] ?? []) as $m) { upsert_message($pdo, $sid, $m); }
    foreach (($data['events'] ?? []) as $e) {
        $e['created_by'] = 'game';
        upsert_event($pdo, $sid, $e, $leaders_dirty);
    }

    if (isset($data['time'])) {
        $stmt = $pdo->prepare('INSERT INTO clock (session_id, time_hours, time_minutes)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
                time_hours = VALUES(time_hours),
                time_minutes = VALUES(time_minutes)');
        $stmt->execute([$sid, $data['time']['h'], $data['time']['m']]);
    }

    if ($leaders_dirty) reconcile_event_leaders($pdo, $sid, true, $leader_event_ids);
    touch_session($pdo, $sid);
    $pdo->commit();
    respond_json(200, ['ok' => true, 'session_id' => $sid]);
}
