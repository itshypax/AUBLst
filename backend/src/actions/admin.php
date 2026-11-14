<?php
declare(strict_types=1);

// Zentrale unter /admin/: Mods und Sitzungen, alles hinter dem OPERATOR_KEY.

const ADMIN_SESSION_LIMIT = 200;

function action_admin_mods(PDO $pdo): void {
    require_operator_key($pdo);
    $stmt = $pdo->query('SELECT m.mod_id, m.name, m.mime_type, m.meters_per_world_unit, m.updated_at,
            LENGTH(m.map_image) AS image_bytes, m.routing_graph,
            (SELECT COUNT(*) FROM sessions s WHERE s.mod_id = m.mod_id) AS sessions
        FROM mods m ORDER BY m.mod_id');
    $mods = [];
    foreach ($stmt->fetchAll() as $row) {
        $mod_id = (string)$row['mod_id'];
        $mods[] = admin_mod_row($row, local_map_definition($mod_id), routing_file_for_mod($mod_id));
    }
    respond_json(200, ['mods' => $mods]);
}

// Dateien in backend/maps haben Vorrang vor dem, was in der Datenbank liegt;
// die Ansicht nennt deshalb je Mod die Quelle, aus der die Leitstelle liest.
function admin_mod_row(array $row, ?array $map_definition, ?string $routing_file): array {
    $image_bytes = (int)($row['image_bytes'] ?? 0);
    $graph = json_decode((string)($row['routing_graph'] ?? ''), true);
    if (!is_array($graph)) $graph = [];
    if ($routing_file) {
        $from_file = json_decode((string)file_get_contents($routing_file), true);
        if (is_array($from_file)) $graph = $from_file;
    }
    $nodes = is_array($graph['nodes'] ?? null) ? count($graph['nodes']) : 0;

    return [
        'mod_id' => (string)$row['mod_id'],
        'name' => $row['name'] !== null ? (string)$row['name'] : null,
        'sessions' => (int)($row['sessions'] ?? 0),
        'updated_at' => (string)($row['updated_at'] ?? ''),
        'meters_per_world_unit' => (float)($row['meters_per_world_unit'] ?? 0.1),
        'map_source' => $map_definition ? 'file' : ($image_bytes > 0 ? 'database' : 'none'),
        'map_file' => $map_definition ? basename((string)$map_definition['file']) : null,
        'map_image_bytes' => $image_bytes,
        'map_mime_type' => $image_bytes > 0 ? (string)($row['mime_type'] ?? '') : null,
        'routing_source' => $routing_file ? 'file' : ($nodes > 0 ? 'database' : 'none'),
        'routing_nodes' => $nodes,
        'routing_edges' => is_array($graph['edges'] ?? null) ? count($graph['edges']) : 0,
        'routing_bma_zones' => is_array($graph['bma_zones'] ?? null) ? count($graph['bma_zones']) : 0,
    ];
}

function action_admin_sessions(PDO $pdo): void {
    require_operator_key($pdo);
    $stmt = $pdo->query('SELECT s.id, s.token, s.mod_id, s.created_at, s.last_activity_at, s.revision,
            s.pin IS NOT NULL AND s.pin <> \'\' AS has_pin,
            (SELECT COUNT(*) FROM players p WHERE p.session_id = s.id) AS players,
            (SELECT COUNT(*) FROM vehicles v WHERE v.session_id = s.id) AS vehicles,
            (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id AND e.status = \'active\') AS open_events
        FROM sessions s ORDER BY s.last_activity_at DESC LIMIT ' . ADMIN_SESSION_LIMIT);
    $sessions = array_map(static fn(array $row): array => [
        'id' => (int)$row['id'],
        'token' => (string)$row['token'],
        'mod_id' => $row['mod_id'] !== null ? (string)$row['mod_id'] : null,
        'has_pin' => (bool)$row['has_pin'],
        'created_at' => (string)$row['created_at'],
        'last_activity_at' => (string)$row['last_activity_at'],
        'players' => (int)$row['players'],
        'vehicles' => (int)$row['vehicles'],
        'open_events' => (int)$row['open_events'],
    ], $stmt->fetchAll());
    respond_json(200, [
        'sessions' => $sessions,
        'limit' => ADMIN_SESSION_LIMIT,
        'ttl_seconds' => SESSION_TTL_SECONDS,
    ]);
}

// Nimmt der laufenden Runde die Leitstelle: Fahrzeuge, Einsätze und Log hängen
// per ON DELETE CASCADE daran.
function action_admin_session_delete(PDO $pdo): void {
    require_operator_key($pdo);
    $session_id = (int)(get_json_input()['session_id'] ?? 0);
    if ($session_id <= 0) respond_json(400, ['error' => 'session_id fehlt.']);
    $stmt = $pdo->prepare('DELETE FROM sessions WHERE id = ?');
    $stmt->execute([$session_id]);
    if ($stmt->rowCount() === 0) respond_json(404, ['error' => 'Die Sitzung gibt es nicht mehr.']);
    respond_json(200, ['ok' => true, 'session_id' => $session_id]);
}
