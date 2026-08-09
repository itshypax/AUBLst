<?php
declare(strict_types=1);

function action_update_vehicles(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null, $data['pin'] ?? null, true);
    $sid = $session['id'];

    foreach (($data['updates'] ?? []) as $u) {
        if (isset($u['status'])) {
            if (!valid_vehicle_status($u['status'])) {
                respond_json(400, ['error' => 'Ungültiger Fahrzeugstatus.']);
            }
        }

        upsert_vehicle($pdo, $sid, $u);
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

    respond_json(200, ['ok' => true]);
}

function action_vehicles_assign_player(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null);
    $sid = $session['id'];

    $vehicle_id = $data['vehicle_id'] ?? null;
    $player_id = $data['player_id'] ?? null;
    if (!$vehicle_id || !$player_id) respond_json(400, ['error' => 'Missing vehicle_id or player_id']);

    $stmt = $pdo->prepare('UPDATE vehicles SET assigned_player_id = ? WHERE id = ? AND session_id = ?');
    $stmt->execute([$player_id, $vehicle_id, $sid]);
    respond_json(200, ['ok' => true]);
}
