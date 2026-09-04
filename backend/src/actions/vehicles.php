<?php
declare(strict_types=1);

function action_update_vehicles(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null, $data['pin'] ?? null, true);
    $sid = $session['id'];

    $updates = $data['updates'] ?? [];
    foreach ($updates as $u) {
        if (isset($u['status'])) {
            if (!valid_vehicle_status($u['status'])) {
                respond_json(400, ['error' => 'Ungültiger Fahrzeugstatus.']);
            }
        }
    }
    $leaders_dirty = false;
    $leader_event_ids = [];
    $changes = ['positions' => false, 'data' => false];
    upsert_vehicles($pdo, $sid, $updates, $leaders_dirty, $leader_event_ids, $changes);
    if ($leaders_dirty) reconcile_event_leaders($pdo, $sid, true, $leader_event_ids);
    if ($changes['data'] || $leaders_dirty) {
        touch_session($pdo, $sid);
    } elseif ($changes['positions']) {
        touch_session_positions($pdo, $sid);
    } else {
        mark_session_activity($pdo, $sid);
    }
    respond_json(200, ['ok' => true]);
}

// Alarmierung ohne Einsatz, für Aktions-Einheiten wie Sperrungen:
// der Adapter setzt event_id -1, das Spiel führt nur den Modus aus
function action_vehicles_alarm(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null, $data['pin'] ?? null, true);
    $sid = $session['id'];

    $vehicle_id = $data['vehicle_id'] ?? null;
    if (!$vehicle_id) respond_json(400, ['error' => 'Missing vehicle_id']);

    $stmt = $pdo->prepare('SELECT * FROM vehicles WHERE id = ? AND session_id = ?');
    $stmt->execute([$vehicle_id, $sid]);
    $veh = $stmt->fetch();
    if (!$veh) respond_json(404, ['error' => 'Vehicle not found']);

    $payload = [
        'event_id' => null,
        'event_game_id' => null,
        'vehicle_id' => (int)$vehicle_id,
        'game_vehicle_id' => $veh['game_vehicle_id'],
        'target' => ['x' => (float)$veh['x'], 'y' => (float)$veh['y']],
        'assign_to_player_id' => null,
    ];
    if (!empty($data['mode'])) {
        $payload['mode'] = $data['mode'];
    }
    $command_id = insert_command($pdo, $sid, 'assign', $payload);
    insert_alarm_history($pdo, $sid, $command_id, [], $veh, null, isset($payload['mode']) ? (string)$payload['mode'] : null);
    touch_session($pdo, $sid);

    respond_json(200, ['ok' => true]);
}

function action_vehicles_assign_player(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null, $data['pin'] ?? null, true);
    $sid = $session['id'];

    $vehicle_id = $data['vehicle_id'] ?? null;
    $player_id = $data['player_id'] ?? null;
    if (!$vehicle_id || !$player_id) respond_json(400, ['error' => 'Missing vehicle_id or player_id']);

    $stmt = $pdo->prepare('UPDATE vehicles SET assigned_player_id = ? WHERE id = ? AND session_id = ?');
    $stmt->execute([$player_id, $vehicle_id, $sid]);
    $vehicle = $pdo->prepare('SELECT game_vehicle_id, name FROM vehicles WHERE session_id = ? AND id = ?');
    $vehicle->execute([$sid, $vehicle_id]);
    $vehicle = $vehicle->fetch();
    if ($vehicle) {
        $label = trim((string)($vehicle['name'] ?? '')) ?: (string)$vehicle['game_vehicle_id'];
        record_vehicle_event_journal($pdo, $sid, (int)$vehicle_id, 'player_assigned', $label . ' einem Spieler zugewiesen');
    }
    touch_session($pdo, $sid);
    respond_json(200, ['ok' => true]);
}
