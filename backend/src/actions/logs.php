<?php
declare(strict_types=1);

function action_logs(PDO $pdo): void {
    $token = request_value('session_token');
    $since = request_value('since', 0);
    $sinceId = max(0, (int)request_value('since_id', 0));
    // MySQL 8 wertet updated_at > '0' als leer aus, ältere Versionen als "alles"
    if (!$since || $since === '0') {
        $since = '1970-01-01 00:00:01';
    }
    $session = require_session($pdo, $token);
    $sid = $session['id'];

    $stmt = $pdo->prepare("SELECT * FROM activity_logs
        WHERE session_id = ?
          AND (updated_at > ? OR (updated_at = ? AND id > ?))
          AND (state = 'active' OR state = 'disabled')
        ORDER BY updated_at ASC, id ASC LIMIT 100");
    $stmt->execute([$sid, $since, $since, $sinceId]);
    respond_json(200, ['logs' => $stmt->fetchAll()]);
}

function action_log_viewed(PDO $pdo): void {
    $data = get_json_input();
    $mid = $data['mid'] ?? 0;
    $session = require_session($pdo, $data['session_token'] ?? null, $data['pin'] ?? null, true);
    $sid = $session['id'];

    $stmt = $pdo->prepare("UPDATE activity_logs
        SET state = 'inactive', updated_at = CURRENT_TIMESTAMP(6)
        WHERE session_id = ? AND id = ?");
    $stmt->execute([$sid, $mid]);
    $stmt = $pdo->prepare('SELECT updated_at FROM activity_logs WHERE session_id = ? AND id = ?');
    $stmt->execute([$sid, $mid]);
    $updatedAt = $stmt->fetchColumn();
    respond_json(200, ['ok' => true, 'updated_at' => $updatedAt ?: null]);
}
