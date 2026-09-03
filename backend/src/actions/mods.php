<?php
declare(strict_types=1);

function action_mods_put(PDO $pdo): void {
    $data = get_json_input();
    $mod_id = $data['mod_id'] ?? null;
    $image_b64 = $data['image_base64'] ?? null;
    $mime = $data['mime_type'] ?? 'image/jpeg';
    $name = $data['name'] ?? null;
    if (!$mod_id || !$image_b64) respond_json(400, ['error' => 'mod_id and image_base64 required']);

    $image_b64 = preg_replace('#^data:[^;]+;base64,#', '', $image_b64);
    $bin = base64_decode($image_b64, true);
    if ($bin === false) respond_json(400, ['error' => 'Invalid base64 for image']);

    $stmt = $pdo->prepare('INSERT INTO mods (mod_id, name, map_image, mime_type)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name), map_image = VALUES(map_image),
            mime_type = VALUES(mime_type), updated_at = CURRENT_TIMESTAMP');
    $stmt->execute([$mod_id, $name, $bin, $mime]);
    respond_json(200, ['ok' => true, 'mod_id' => $mod_id]);
}

function local_map_definition(string $mod_id): ?array {
    if (!preg_match('/^[A-Za-z0-9_.-]{1,255}$/', $mod_id)) return null;
    $maps_dir = __DIR__ . '/../../maps/';
    $metadata_file = $maps_dir . $mod_id . '.map.json';
    if (is_file($metadata_file)) {
        $metadata = json_decode((string)file_get_contents($metadata_file), true);
        $image_name = is_array($metadata) ? (string)($metadata['image'] ?? '') : '';
        if (preg_match('/^[A-Za-z0-9_.-]+\.(?:jpe?g|png|webp)$/i', $image_name)) {
            $file = $maps_dir . $image_name;
            if (is_file($file)) {
                $rect = is_array($metadata['content_rect'] ?? null) ? $metadata['content_rect'] : null;
                $content_rect = $rect ? [
                    'x' => max(0, (float)($rect['x'] ?? 0)),
                    'y' => max(0, (float)($rect['y'] ?? 0)),
                    'width' => max(1, (float)($rect['width'] ?? 1)),
                    'height' => max(1, (float)($rect['height'] ?? 1)),
                ] : null;
                return ['file' => $file, 'content_rect' => $content_rect];
            }
        }
    }

    foreach (['jpg', 'jpeg', 'png', 'webp'] as $ext) {
        $file = $maps_dir . $mod_id . '.' . $ext;
        if (is_file($file)) return ['file' => $file, 'content_rect' => null];
    }
    return null;
}

function map_content_rect_for_mod(?string $mod_id): ?array {
    if (!$mod_id) return null;
    return local_map_definition($mod_id)['content_rect'] ?? null;
}

function map_image_version_for_mod(?string $mod_id): ?string {
    if (!$mod_id) return null;
    $definition = local_map_definition($mod_id);
    if (!$definition) return null;
    return dechex((int)filemtime($definition['file'])) . '-' . dechex((int)filesize($definition['file']));
}

function action_map_asset(): void {
    $mod_id = trim((string)request_value('mod_id', ''));
    $local_map = local_map_definition($mod_id);
    if (!$local_map) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Map image not found';
        exit;
    }
    $mimes = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];
    $ext = strtolower((string)pathinfo($local_map['file'], PATHINFO_EXTENSION));
    $etag = '"' . map_image_version_for_mod($mod_id) . '"';
    if (trim((string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
        http_response_code(304);
        exit;
    }
    send_cors_headers();
    header('Content-Type: ' . ($mimes[$ext] ?? 'application/octet-stream'));
    header('Cache-Control: public, max-age=31536000, immutable');
    header('ETag: ' . $etag);
    header('Content-Length: ' . filesize($local_map['file']));
    readfile($local_map['file']);
    exit;
}

function action_map_image(PDO $pdo): void {
    $token = request_value('session_token');
    $session = require_session($pdo, $token);
    send_cors_headers();

    if (!$session['mod_id']) {
        http_response_code(404);
        header('Content-Type: text/plain');
        echo 'No mod_id set for session';
        exit;
    }

    // Eine Datei in backend/maps/ hat Vorrang vor dem Upload in der Datenbank
    $mod_id = $session['mod_id'];
    $local_map = local_map_definition((string)$mod_id);
    if ($local_map) {
        $mimes = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];
        $ext = strtolower((string)pathinfo($local_map['file'], PATHINFO_EXTENSION));
        header('Content-Type: ' . ($mimes[$ext] ?? 'application/octet-stream'));
        header('Cache-Control: private, max-age=60');
        readfile($local_map['file']);
        exit;
    }

    $stmt = $pdo->prepare('SELECT map_image, mime_type FROM mods WHERE mod_id = ?');
    $stmt->execute([$session['mod_id']]);
    $row = $stmt->fetch();
    if (!$row || !$row['map_image']) {
        http_response_code(404);
        header('Content-Type: text/plain');
        echo 'Map image not found';
        exit;
    }
    header('Content-Type: ' . ($row['mime_type'] ?: 'image/jpeg'));
    header('Cache-Control: private, max-age=60');
    echo $row['map_image'];
    exit;
}

function empty_routing_config(float $meters_per_world_unit = 0.1): array {
    return [
        'coordinate_space' => 'world',
        'meters_per_world_unit' => $meters_per_world_unit,
        'grid_size_m' => 50.0,
        'nodes' => [],
        'edges' => [],
        'bma_zones' => [],
    ];
}

function optional_positive_number(array $data, string $key, float $minimum, float $maximum): ?float {
    if (!isset($data[$key]) || $data[$key] === '') return null;
    $value = (float)$data[$key];
    if (!is_finite($value) || $value < $minimum || $value > $maximum) {
        throw new InvalidArgumentException("Der Wert $key liegt außerhalb des erlaubten Bereichs.");
    }
    return $value;
}

function normalize_routing_config(array $data): array {
    $scale = (float)($data['meters_per_world_unit'] ?? 0.1);
    if (!is_finite($scale) || $scale < 0.001 || $scale > 10) {
        throw new InvalidArgumentException('Der Kartenmaßstab muss zwischen 0,001 und 10 Metern pro Spielkoordinate liegen.');
    }

    $input_nodes = $data['nodes'] ?? [];
    $input_edges = $data['edges'] ?? [];
    if (!is_array($input_nodes) || !is_array($input_edges)) {
        throw new InvalidArgumentException('Das Straßennetz hat ein ungültiges Format.');
    }
    if (count($input_nodes) > 10000 || count($input_edges) > 20000) {
        throw new InvalidArgumentException('Das Straßennetz ist zu groß.');
    }

    $nodes = [];
    $node_ids = [];
    foreach ($input_nodes as $node) {
        if (!is_array($node)) continue;
        $id = (string)($node['id'] ?? '');
        $x = isset($node['x']) ? (float)$node['x'] : NAN;
        $y = isset($node['y']) ? (float)$node['y'] : NAN;
        if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', $id) || isset($node_ids[$id]) || !is_finite($x) || !is_finite($y)) continue;
        $node_ids[$id] = true;
        $nodes[] = ['id' => $id, 'x' => $x, 'y' => $y];
    }

    $edges = [];
    $edge_ids = [];
    foreach ($input_edges as $edge) {
        if (!is_array($edge)) continue;
        $id = (string)($edge['id'] ?? '');
        $from = (string)($edge['from'] ?? '');
        $to = (string)($edge['to'] ?? '');
        $kind = ($edge['kind'] ?? 'road') === 'bridge' ? 'bridge' : 'road';
        $name = trim((string)($edge['name'] ?? ''));
        if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', $id) || isset($edge_ids[$id])) continue;
        if ($from === $to || !isset($node_ids[$from]) || !isset($node_ids[$to])) continue;
        if ($name !== '' && !preg_match('/^.{1,120}$/us', $name)) $name = '';
        $edge_ids[$id] = true;
        $normalized_edge = ['id' => $id, 'from' => $from, 'to' => $to, 'kind' => $kind];
        if ($name !== '') $normalized_edge['name'] = $name;
        $edges[] = $normalized_edge;
    }

    $bma_zones = [];
    $bma_ids = [];
    foreach (($data['bma_zones'] ?? []) as $zone) {
        if (!is_array($zone)) continue;
        $id = (string)($zone['id'] ?? '');
        $name = trim((string)($zone['name'] ?? ''));
        $input_points = is_array($zone['points'] ?? null) ? $zone['points'] : [];
        if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', $id) || isset($bma_ids[$id]) || !preg_match('/^.{1,120}$/us', $name)
            || count($input_points) < 3 || count($input_points) > 100) continue;
        $points = [];
        foreach ($input_points as $point) {
            $x = is_array($point) && isset($point['x']) ? (float)$point['x'] : NAN;
            $y = is_array($point) && isset($point['y']) ? (float)$point['y'] : NAN;
            if (!is_finite($x) || !is_finite($y)) {
                $points = [];
                break;
            }
            $points[] = ['x' => $x, 'y' => $y];
        }
        if (count($points) < 3) continue;
        $bma_ids[$id] = true;
        $bma_zones[] = ['id' => $id, 'name' => $name, 'points' => $points];
    }

    $coordinate_space = ($data['coordinate_space'] ?? 'world') === 'normalized' ? 'normalized' : 'world';
    $map_width_px = optional_positive_number($data, 'map_width_px', 1, 100000);
    $map_height_px = optional_positive_number($data, 'map_height_px', 1, 100000);
    $pixels_per_meter = optional_positive_number($data, 'pixels_per_meter', 0.01, 10000);
    $grid_size_m = optional_positive_number($data, 'grid_size_m', 1, 1000) ?? 50.0;
    $meters_per_world_unit_x = optional_positive_number($data, 'meters_per_world_unit_x', 0.000001, 10000);
    $meters_per_world_unit_y = optional_positive_number($data, 'meters_per_world_unit_y', 0.000001, 10000);
    return [
        'coordinate_space' => $coordinate_space,
        'meters_per_world_unit' => $scale,
        'meters_per_world_unit_x' => $meters_per_world_unit_x,
        'meters_per_world_unit_y' => $meters_per_world_unit_y,
        'map_width_px' => $map_width_px,
        'map_height_px' => $map_height_px,
        'pixels_per_meter' => $pixels_per_meter,
        'grid_size_m' => $grid_size_m,
        'nodes' => $nodes,
        'edges' => $edges,
        'bma_zones' => $bma_zones,
    ];
}

function routing_file_for_mod(string $mod_id): ?string {
    if (!preg_match('/^[A-Za-z0-9_.-]{1,255}$/', $mod_id)) return null;
    $file = __DIR__ . '/../../maps/' . $mod_id . '.routing.json';
    return is_file($file) ? $file : null;
}

function routing_version_for_mod(?string $mod_id): ?string {
    if (!$mod_id) return null;
    $file = routing_file_for_mod($mod_id);
    if (!$file) return null;
    $modified = @filemtime($file);
    $size = @filesize($file);
    if ($modified === false || $size === false) return null;
    return $modified . ':' . $size;
}

function routing_for_session(array $config, array $session): array {
    if (($config['coordinate_space'] ?? 'world') !== 'normalized') return $config;
    $min_x = (float)$session['min_x'];
    $min_y = (float)$session['min_y'];
    $range_x = (float)$session['max_x'] - $min_x;
    $range_y = (float)$session['max_y'] - $min_y;
    $pixels_per_meter = (float)($config['pixels_per_meter'] ?? 0);
    $map_width_px = (float)($config['map_width_px'] ?? 0);
    $map_height_px = (float)($config['map_height_px'] ?? 0);
    if ($pixels_per_meter > 0 && $map_width_px > 0 && abs($range_x) > 0) {
        $config['meters_per_world_unit_x'] = ($map_width_px / $pixels_per_meter) / abs($range_x);
    }
    if ($pixels_per_meter > 0 && $map_height_px > 0 && abs($range_y) > 0) {
        $config['meters_per_world_unit_y'] = ($map_height_px / $pixels_per_meter) / abs($range_y);
    }
    if (isset($config['meters_per_world_unit_x'])) {
        $config['meters_per_world_unit'] = (float)$config['meters_per_world_unit_x'];
    }
    foreach ($config['nodes'] as &$node) {
        $node['x'] = $min_x + (float)$node['x'] * $range_x;
        $node['y'] = -($min_y + (-(float)$node['y']) * $range_y);
    }
    unset($node);
    foreach ($config['bma_zones'] as &$zone) {
        foreach ($zone['points'] as &$point) {
            $point['x'] = $min_x + (float)$point['x'] * $range_x;
            $point['y'] = -($min_y + (-(float)$point['y']) * $range_y);
        }
        unset($point);
    }
    unset($zone);
    $config['coordinate_space'] = 'world';
    return $config;
}

function action_routing_get(PDO $pdo): void {
    $session = require_session($pdo, request_value('session_token'));
    if (!$session['mod_id']) respond_json(200, empty_routing_config());

    $routing_file = routing_file_for_mod((string)$session['mod_id']);
    if ($routing_file) {
        $saved = json_decode((string)file_get_contents($routing_file), true);
        if (!is_array($saved)) respond_json(500, ['error' => 'Die Routing-Datei ist ungültig.']);
        respond_json(200, routing_for_session(normalize_routing_config($saved), $session));
    }

    $stmt = $pdo->prepare('SELECT meters_per_world_unit, routing_graph FROM mods WHERE mod_id = ?');
    $stmt->execute([$session['mod_id']]);
    $row = $stmt->fetch();
    if (!$row) respond_json(200, empty_routing_config());

    $graph = $row['routing_graph'] ? json_decode((string)$row['routing_graph'], true) : [];
    if (!is_array($graph)) $graph = [];
    $graph['meters_per_world_unit'] = (float)($row['meters_per_world_unit'] ?? 0.1);
    respond_json(200, routing_for_session(normalize_routing_config($graph), $session));
}

function action_routing_put(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null, $data['pin'] ?? null, true);
    if (!$session['mod_id']) respond_json(400, ['error' => 'Die Sitzung hat keine Karte.']);

    try {
        $config = normalize_routing_config($data);
    } catch (InvalidArgumentException $error) {
        respond_json(400, ['error' => $error->getMessage()]);
    }
    $graph = json_encode([
        'coordinate_space' => $config['coordinate_space'],
        'map_width_px' => $config['map_width_px'],
        'map_height_px' => $config['map_height_px'],
        'pixels_per_meter' => $config['pixels_per_meter'],
        'grid_size_m' => $config['grid_size_m'],
        'nodes' => $config['nodes'],
        'edges' => $config['edges'],
        'bma_zones' => $config['bma_zones'],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $stmt = $pdo->prepare('UPDATE mods SET meters_per_world_unit = ?, routing_graph = ?, updated_at = CURRENT_TIMESTAMP WHERE mod_id = ?');
    $stmt->execute([$config['meters_per_world_unit'], $graph, $session['mod_id']]);
    respond_json(200, ['ok' => true] + $config);
}
