<?php
declare(strict_types=1);

// poll_ms sagt dem Adapter, wann er wieder fragen soll. Ältere Adapter ignorieren es.
function action_commands_pending(PDO $pdo): void {
    $token = $_GET['session_token'] ?? null;
    $session = require_session($pdo, $token);
    $sid = $session['id'];
    $last_id = isset($_GET['last_id']) ? (int)$_GET['last_id'] : 0;
    // Vor der Abfrage lesen: Ein Befehl, der währenddessen dazukommt, macht die Marke ungültig.
    $revision = command_cache_revision($sid);

    $stmt = $pdo->prepare('SELECT * FROM commands WHERE session_id = ? AND id > ? AND processed = 0 ORDER BY id ASC LIMIT 500');
    $stmt->execute([$sid, $last_id]);
    $commands = $stmt->fetchAll();
    if (!$commands && $last_id === 0) {
        command_cache_mark_empty(strtolower(trim((string)$token)), $sid, $revision);
    }
    respond_json(200, ['commands' => $commands, 'poll_ms' => command_poll_ms($sid)]);
}

// Beantwortet einen leeren Abruf aus dem APCu, bevor api.php die Datenbank öffnet.
// Kehrt ohne Antwort zurück, wenn es offene Befehle geben könnte.
function commands_pending_from_cache(): void {
    $token = strtolower(trim((string)($_GET['session_token'] ?? '')));
    if ($token === '' || (int)($_GET['last_id'] ?? 0) !== 0) return;
    $sid = command_cache_known_empty($token);
    if ($sid !== null) {
        respond_json(200, ['commands' => [], 'poll_ms' => command_poll_ms($sid)]);
    }
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
