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
    if (preg_match('/^[\w.-]+$/', $mod_id)) {
        $mimes = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];
        foreach ($mimes as $ext => $mime) {
            $file = __DIR__ . '/../../maps/' . $mod_id . '.' . $ext;
            if (is_file($file)) {
                header('Content-Type: ' . $mime);
                header('Cache-Control: private, max-age=60');
                readfile($file);
                exit;
            }
        }
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
