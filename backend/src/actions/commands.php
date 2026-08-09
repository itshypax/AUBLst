<?php
declare(strict_types=1);

function action_commands_pending(PDO $pdo): void {
    $token = $_GET['session_token'] ?? null;
    $session = require_session($pdo, $token);
    $sid = $session['id'];
    $last_id = isset($_GET['last_id']) ? (int)$_GET['last_id'] : 0;

    $stmt = $pdo->prepare('SELECT * FROM commands WHERE session_id = ? AND id > ? AND processed = 0 ORDER BY id ASC LIMIT 500');
    $stmt->execute([$sid, $last_id]);
    respond_json(200, ['commands' => $stmt->fetchAll()]);
}

function action_commands_ack(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null);
    $sid = $session['id'];

    $ids = $data['command_ids'] ?? [];
    if (!$ids) respond_json(400, ['error' => 'Empty command_ids']);

    $in = implode(',', array_fill(0, count($ids), '?'));
    $params = $ids;
    array_unshift($params, $sid);
    $stmt = $pdo->prepare("UPDATE commands SET processed = 1, processed_at = CURRENT_TIMESTAMP WHERE session_id = ? AND id IN ($in)");
    $stmt->execute($params);
    respond_json(200, ['ok' => true, 'updated' => count($ids)]);
}
