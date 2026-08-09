<?php
declare(strict_types=1);

function action_session_create(PDO $pdo): void {
    $data = get_json_input();
    $session = create_session($pdo, $data['mod_id'] ?? null, $data['pin'] ?? null, $data['map_bounds'] ?? null);
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

function action_session_statistics(PDO $pdo): void {
    $session = require_session($pdo, request_value('session_token'));
    $sid = $session['id'];

    $stmt = $pdo->prepare('SELECT id, name, status, created_by, created_at, updated_at
        FROM events WHERE session_id = ? ORDER BY created_at ASC, id ASC');
    $stmt->execute([$sid]);
    $events = $stmt->fetchAll();

    backfill_alarm_history($pdo, $sid);
    $stmt = $pdo->prepare('SELECT event_id, game_vehicle_id, vehicle_name, mode, created_at
        FROM alarm_history WHERE session_id = ? ORDER BY created_at ASC, id ASC');
    $stmt->execute([$sid]);
    $dispatches = $stmt->fetchAll();

    $stmt = $pdo->prepare('SELECT COUNT(*) FROM activity_logs WHERE session_id = ?');
    $stmt->execute([$sid]);
    $log_count = (int)$stmt->fetchColumn();
    $generated_at = (string)$pdo->query('SELECT NOW()')->fetchColumn();

    respond_json(200, [
        'session' => [
            'token' => $session['token'],
            'created_at' => $session['created_at'],
            'generated_at' => $generated_at,
        ],
        'events' => $events,
        'dispatches' => $dispatches,
        'log_count' => $log_count,
    ]);
}

function action_sync(PDO $pdo): void {
    $data = get_json_input();
    $token = $data['session_token'] ?? null;
    if (!$token) respond_json(400, ['error' => 'Missing session_token']);

    $mod_id = $data['mod_id'] ?? null;

    $pdo->beginTransaction();
    ensure_mod_row($pdo, $mod_id);

    // mod_id is fixed for the lifetime of a session, IFNULL keeps the first value
    $bounds = $data['map_bounds'] ?? null;
    if ($bounds) {
        $stmt = $pdo->prepare('INSERT INTO sessions (token, mod_id, min_x, min_y, max_x, max_y)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                min_x = VALUES(min_x),
                min_y = VALUES(min_y),
                max_x = VALUES(max_x),
                max_y = VALUES(max_y),
                updated_at = CURRENT_TIMESTAMP,
                mod_id = IFNULL(mod_id, VALUES(mod_id))');
        $stmt->execute([
            $token, $mod_id,
            n($bounds['min_x'] ?? 0), n($bounds['min_y'] ?? 0),
            n($bounds['max_x'] ?? 1000), n($bounds['max_y'] ?? 1000),
        ]);
    } else {
        $stmt = $pdo->prepare('INSERT INTO sessions (token, mod_id)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE
                updated_at = CURRENT_TIMESTAMP,
                mod_id = IFNULL(mod_id, VALUES(mod_id))');
        $stmt->execute([$token, $mod_id]);
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
    foreach (($data['vehicles'] ?? []) as $v) { upsert_vehicle($pdo, $sid, $v); }
    foreach (($data['hospitals'] ?? []) as $h) { upsert_hospital($pdo, $sid, $h); }
    foreach (($data['messages'] ?? []) as $m) { upsert_message($pdo, $sid, $m); }
    foreach (($data['events'] ?? []) as $e) { $e['created_by'] = 'game'; upsert_event($pdo, $sid, $e); }

    if (isset($data['time'])) {
        $stmt = $pdo->prepare('INSERT INTO clock (session_id, time_hours, time_minutes)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
                time_hours = VALUES(time_hours),
                time_minutes = VALUES(time_minutes)');
        $stmt->execute([$sid, $data['time']['h'], $data['time']['m']]);
    }

    $pdo->commit();
    respond_json(200, ['ok' => true, 'session_id' => $sid]);
}
