<?php
declare(strict_types=1);

function action_state(PDO $pdo): void {
    $token = request_value('session_token');
    $session = require_session($pdo, $token);
    $sid = $session['id'];

    $players = $pdo->prepare('SELECT id, player_uid as player_id, name FROM players WHERE session_id = ? ORDER BY name');
    $players->execute([$sid]);
    $players = $players->fetchAll();

    $vehicles = $pdo->prepare('SELECT v.*,
        (SELECT h.created_at FROM vehicle_status_history h
            WHERE h.session_id = v.session_id AND h.vehicle_id = v.id
            ORDER BY h.created_at DESC, h.id DESC LIMIT 1) AS status_since
        FROM vehicles v WHERE v.session_id = ?');
    $vehicles->execute([$sid]);
    $vehicles = $vehicles->fetchAll();

    $hospitals = $pdo->prepare('SELECT * FROM hospitals WHERE session_id = ?');
    $hospitals->execute([$sid]);
    $hospitals = $hospitals->fetchAll();

    $events = $pdo->prepare("SELECT * FROM events WHERE session_id = ? AND status != 'completed'");
    $events->execute([$sid]);
    $events = $events->fetchAll();

    $assignments = $pdo->prepare('SELECT a.event_id, a.vehicle_id, h.mode
        FROM assignments a
        LEFT JOIN alarm_history h ON h.session_id = a.session_id
            AND h.event_id = a.event_id AND h.vehicle_id = a.vehicle_id AND h.mode IS NOT NULL
        WHERE a.session_id = ? ORDER BY a.event_id, a.vehicle_id, h.id');
    $assignments->execute([$sid]);
    $assignmentRows = $assignments->fetchAll();
    $assignments = [];
    foreach ($assignmentRows as $row) {
        $key = (int)$row['event_id'] . ':' . (int)$row['vehicle_id'];
        if (!isset($assignments[$key])) {
            $assignments[$key] = [
                'event_id' => (int)$row['event_id'],
                'vehicle_id' => (int)$row['vehicle_id'],
                'alarm_modes' => [],
            ];
        }
        if ($row['mode'] !== null && trim((string)$row['mode']) !== '') {
            $assignments[$key]['alarm_modes'][] = (string)$row['mode'];
        }
    }
    $assignments = array_values($assignments);

    $cleanup = $pdo->prepare('DELETE r FROM hospital_reservations r
        JOIN vehicles v ON v.id = r.vehicle_id AND v.session_id = r.session_id
        WHERE r.session_id = ? AND v.status IN (1, 2)');
    $cleanup->execute([$sid]);

    $hospital_reservations = $pdo->prepare('SELECT r.id, r.vehicle_id, r.hospital_id, r.bed_type, r.status,
        r.created_at, r.updated_at, r.arrived_at, v.game_vehicle_id, v.name AS vehicle_name, h.name AS hospital_name
        FROM hospital_reservations r
        JOIN vehicles v ON v.id = r.vehicle_id AND v.session_id = r.session_id
        JOIN hospitals h ON h.id = r.hospital_id AND h.session_id = r.session_id
        WHERE r.session_id = ? ORDER BY r.created_at ASC, r.id ASC');
    $hospital_reservations->execute([$sid]);
    $hospital_reservations = $hospital_reservations->fetchAll();

    $time = $pdo->prepare('SELECT * FROM clock WHERE session_id = ?');
    $time->execute([$sid]);
    $time = $time->fetch();

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
        ],
        'players' => $players,
        'vehicles' => $vehicles,
        'hospitals' => $hospitals,
        'events' => $events,
        'assignments' => $assignments,
        'hospital_reservations' => $hospital_reservations,
        'time' => $time,
    ]);
}
