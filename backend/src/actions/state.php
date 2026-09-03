<?php
declare(strict_types=1);

function state_assignments(PDO $pdo, $session_id): array {
    $stmt = $pdo->prepare('SELECT a.event_id, a.vehicle_id, h.mode, leaders.role AS leader_role,
            leaders.source AS leader_source
        FROM assignments a
        JOIN events e ON e.session_id = a.session_id AND e.id = a.event_id AND e.status = \'active\'
        LEFT JOIN alarm_history h ON h.session_id = a.session_id
            AND h.event_id = a.event_id AND h.vehicle_id = a.vehicle_id AND h.mode IS NOT NULL
        LEFT JOIN event_leaders leaders ON leaders.session_id = a.session_id
            AND leaders.event_id = a.event_id AND leaders.vehicle_id = a.vehicle_id
        WHERE a.session_id = ? ORDER BY a.event_id, a.vehicle_id, h.id');
    $stmt->execute([$session_id]);

    $assignments = [];
    foreach ($stmt->fetchAll() as $row) {
        $key = (int)$row['event_id'] . ':' . (int)$row['vehicle_id'];
        if (!isset($assignments[$key])) {
            $assignments[$key] = [
                'event_id' => (int)$row['event_id'],
                'vehicle_id' => (int)$row['vehicle_id'],
                'alarm_modes' => [],
                'leader_role' => $row['leader_role'],
                'leader_source' => $row['leader_source'],
            ];
        }
        if ($row['mode'] !== null && trim((string)$row['mode']) !== '') {
            $assignments[$key]['alarm_modes'][] = (string)$row['mode'];
        }
    }
    return array_values($assignments);
}

function state_session_data(array $session): array {
    return [
        'token' => $session['token'],
        'revision' => (int)($session['revision'] ?? 0),
        'mod_id' => $session['mod_id'],
        'routing_version' => routing_version_for_mod($session['mod_id'] ?? null),
        'map_image_version' => map_image_version_for_mod($session['mod_id'] ?? null),
        'monitor_show_hospital_capacity' => (bool)($session['monitor_show_hospital_capacity'] ?? false),
        'map_content_rect' => map_content_rect_for_mod($session['mod_id'] ?? null),
        'map_bounds' => [
            'min_x' => (float)$session['min_x'],
            'min_y' => (float)$session['min_y'],
            'max_x' => (float)$session['max_x'],
            'max_y' => (float)$session['max_y'],
        ],
    ];
}

function state_not_modified(array $session): bool {
    $known = request_value('known_revision');
    if ($known === null || $known === '') return false;
    if ((int)$known !== (int)($session['revision'] ?? 0)) return false;
    respond_json(200, ['unchanged' => true, 'revision' => (int)$session['revision']]);
}

function state_cache_fetch(int $session_id, int $revision, string $profile): ?array {
    if ((int)STATE_CACHE_SECONDS <= 0 || !function_exists('apcu_fetch')) return null;
    $success = false;
    $value = apcu_fetch("aublst:state:$profile:$session_id:$revision", $success);
    return $success && is_array($value) ? $value : null;
}

function state_cache_store(int $session_id, int $revision, string $profile, array $payload): void {
    if ((int)STATE_CACHE_SECONDS <= 0 || !function_exists('apcu_store')) return;
    apcu_store("aublst:state:$profile:$session_id:$revision", $payload, (int)STATE_CACHE_SECONDS);
}

function state_hospital_capacity_level(int $available): string {
    if ($available <= 0) return 'full';
    if ($available <= 2) return 'low';
    return 'ok';
}

function state_monitor_hospital_capacities(PDO $pdo, int $session_id): array {
    $stmt = $pdo->prepare("SELECT h.id, h.name,
            GREATEST(0, h.ward_available - COALESCE(SUM(CASE
                WHEN r.bed_type = 'ward' AND (r.status = 'reserved' OR (r.status = 'arrived' AND v.status = 8)) THEN 1
                ELSE 0 END), 0)) AS ward_effective,
            GREATEST(0, h.icu_available - COALESCE(SUM(CASE
                WHEN r.bed_type = 'icu' AND (r.status = 'reserved' OR (r.status = 'arrived' AND v.status = 8)) THEN 1
                ELSE 0 END), 0)) AS icu_effective
        FROM hospitals h
        LEFT JOIN hospital_reservations r ON r.session_id = h.session_id AND r.hospital_id = h.id
        LEFT JOIN vehicles v ON v.session_id = r.session_id AND v.id = r.vehicle_id
        WHERE h.session_id = ?
        GROUP BY h.id, h.name, h.ward_available, h.icu_available
        ORDER BY h.name, h.id");
    $stmt->execute([$session_id]);

    return array_map(static fn(array $hospital): array => [
        'id' => (int)$hospital['id'],
        'name' => $hospital['name'],
        'ward_level' => state_hospital_capacity_level((int)$hospital['ward_effective']),
        'icu_level' => state_hospital_capacity_level((int)$hospital['icu_effective']),
    ], $stmt->fetchAll());
}

function action_monitor_state(PDO $pdo): void {
    $session = require_session($pdo, request_value('session_token'));
    state_not_modified($session);
    $sid = (int)$session['id'];
    $revision = (int)($session['revision'] ?? 0);
    $cached = state_cache_fetch($sid, $revision, 'monitor');
    if ($cached !== null) respond_json(200, $cached);

    $vehicles = $pdo->prepare('SELECT id, game_vehicle_id, name, type, modes, x, y, status, assigned_player_id
        FROM vehicles WHERE session_id = ?');
    $vehicles->execute([$sid]);

    $events = $pdo->prepare("SELECT id, game_event_id, name, x, y, status, created_by, created_at, updated_at
        FROM events WHERE session_id = ? AND status = 'active' ORDER BY created_at DESC, id DESC");
    $events->execute([$sid]);

    $time = $pdo->prepare('SELECT time_hours, time_minutes FROM clock WHERE session_id = ?');
    $time->execute([$sid]);

    $show_hospital_capacity = (bool)($session['monitor_show_hospital_capacity'] ?? false);

    $payload = [
        'session' => state_session_data($session),
        'players' => [],
        'vehicles' => $vehicles->fetchAll(),
        'hospitals' => [],
        'events' => $events->fetchAll(),
        'assignments' => state_assignments($pdo, $sid),
        'hospital_reservations' => [],
        'monitor_hospital_capacities' => $show_hospital_capacity
            ? state_monitor_hospital_capacities($pdo, (int)$sid)
            : [],
        'time' => $time->fetch() ?: null,
    ];
    state_cache_store($sid, $revision, 'monitor', $payload);
    respond_json(200, $payload);
}

function action_state(PDO $pdo): void {
    $token = request_value('session_token');
    $session = require_session($pdo, $token);
    state_not_modified($session);
    $sid = (int)$session['id'];
    $revision = (int)($session['revision'] ?? 0);
    $cached = state_cache_fetch($sid, $revision, 'control');
    if ($cached !== null) respond_json(200, $cached);

    $players = $pdo->prepare('SELECT id, player_uid as player_id, name FROM players WHERE session_id = ? ORDER BY name');
    $players->execute([$sid]);
    $players = $players->fetchAll();

    $vehicles = $pdo->prepare('SELECT v.*, h.created_at AS status_since
        FROM vehicles v
        LEFT JOIN (
            SELECT vehicle_id, MAX(id) AS latest_id
            FROM vehicle_status_history WHERE session_id = ? GROUP BY vehicle_id
        ) latest ON latest.vehicle_id = v.id
        LEFT JOIN vehicle_status_history h ON h.id = latest.latest_id
        WHERE v.session_id = ?');
    $vehicles->execute([$sid, $sid]);
    $vehicles = $vehicles->fetchAll();

    $hospitals = $pdo->prepare('SELECT * FROM hospitals WHERE session_id = ?');
    $hospitals->execute([$sid]);
    $hospitals = $hospitals->fetchAll();

    $events = $pdo->prepare("SELECT * FROM events WHERE session_id = ? AND status = 'active' ORDER BY created_at DESC, id DESC");
    $events->execute([$sid]);
    $events = $events->fetchAll();

    $assignments = state_assignments($pdo, $sid);

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

    $payload = [
        'session' => state_session_data($session),
        'players' => $players,
        'vehicles' => $vehicles,
        'hospitals' => $hospitals,
        'events' => $events,
        'assignments' => $assignments,
        'hospital_reservations' => $hospital_reservations,
        'monitor_hospital_capacities' => [],
        'time' => $time,
    ];
    state_cache_store($sid, $revision, 'control', $payload);
    respond_json(200, $payload);
}

function action_status_history(PDO $pdo): void {
    $session = require_session($pdo, request_value('session_token'));
    $stmt = $pdo->prepare('SELECT id, game_vehicle_id, vehicle_name, status, created_at
        FROM vehicle_status_history WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 500');
    $stmt->execute([$session['id']]);
    respond_json(200, ['status_history' => $stmt->fetchAll()]);
}
