<?php
declare(strict_types=1);

// Das Fenster-Log des Adapters, für die Betreiberansicht. Der Adapter kürzt
// Pfade und lässt Spielzeilen, PIN und Namen weg, bevor er sendet.
const SESSION_LOG_LEVELS = ['info', 'good', 'warn', 'bad'];
const SESSION_LOG_MAX_ENTRIES = 50;
const SESSION_LOG_MAX_TEXT = 500;
const SESSION_LOG_MAX_PER_SESSION = 2000;
const SESSION_LOG_LIST_LIMIT = 5000;

function action_adapter_log(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null);
    $entries = $data['entries'] ?? null;
    if (!is_array($entries) || !array_is_list($entries) || count($entries) > SESSION_LOG_MAX_ENTRIES) {
        respond_json(400, ['error' => 'entries muss eine Liste mit höchstens ' . SESSION_LOG_MAX_ENTRIES . ' Einträgen sein']);
    }
    $rows = normalize_adapter_log_entries($entries, new DateTimeImmutable('now', app_time_zone()));

    // Ab Adapter 1.5 kommt bei jeder Lieferung mit, ob Spiel und Runde laufen.
    $status = normalize_adapter_status($data['status'] ?? null);
    if ($status !== null) {
        $stmt = $pdo->prepare('UPDATE sessions SET adapter_status = ?, adapter_seen_at = CURRENT_TIMESTAMP WHERE id = ?');
        $stmt->execute([json_encode($status), (int)$session['id']]);
    }

    $count = $pdo->prepare('SELECT COUNT(*) FROM session_log WHERE session_id = ?');
    $count->execute([(int)$session['id']]);
    $room = max(0, SESSION_LOG_MAX_PER_SESSION - (int)$count->fetchColumn());
    $rows = array_slice($rows, 0, $room);

    $insert = $pdo->prepare('INSERT INTO session_log (session_id, created_at, level, text) VALUES (?, ?, ?, ?)');
    foreach ($rows as $row) {
        $insert->execute([(int)$session['id'], $row['created_at'], $row['level'], $row['text']]);
    }
    respond_json(200, ['ok' => true, 'stored' => count($rows)]);
}

// Ungültige Einträge fallen weg statt die ganze Lieferung abzulehnen. Die Uhr
// des Spielrechners kann falsch gehen, Zeiten außerhalb der letzten 24 Stunden
// werden zur Empfangszeit.
function normalize_adapter_log_entries(array $entries, DateTimeImmutable $now): array {
    $rows = [];
    foreach ($entries as $entry) {
        if (!is_array($entry)) continue;
        $level = $entry['level'] ?? null;
        $text = $entry['text'] ?? null;
        if (!is_string($level) || !in_array($level, SESSION_LOG_LEVELS, true) || !is_string($text)) continue;
        $text = trim(preg_replace('/\s+/u', ' ', $text) ?? '');
        if ($text === '') continue;
        $time = $now;
        if (is_string($entry['time'] ?? null)) {
            try {
                $time = new DateTimeImmutable($entry['time']);
            } catch (Throwable) {
            }
        }
        if ($time > $now || $time < $now->modify('-' . SESSION_LOG_KEEP_SECONDS . ' seconds')) $time = $now;
        $rows[] = [
            'created_at' => $time->setTimezone(app_time_zone())->format('Y-m-d H:i:s'),
            'level' => $level,
            'text' => mb_substr($text, 0, SESSION_LOG_MAX_TEXT),
        ];
    }
    return $rows;
}

function normalize_adapter_status(mixed $status): ?array {
    if (!is_array($status) || !is_bool($status['game'] ?? null) || !is_bool($status['round'] ?? null)) return null;
    $version = $status['version'] ?? null;
    return [
        'game' => $status['game'],
        'round' => $status['round'],
        'version' => is_string($version) ? mb_substr($version, 0, 20) : '',
    ];
}

// Für die Leitstelle: der letzte gemeldete Zustand und wie alt er ist. Das Alter
// rechnet der Server, damit eine falsch gehende Uhr im Browser nichts verfälscht.
function adapter_status_view(array $session, DateTimeImmutable $now): ?array {
    $status = json_decode((string)($session['adapter_status'] ?? ''), true);
    $seen = $session['adapter_seen_at'] ?? null;
    if (!is_array($status) || !is_string($seen)) return null;
    $status['age'] = max(0, $now->getTimestamp() - (new DateTimeImmutable($seen, app_time_zone()))->getTimestamp());
    return $status;
}

function action_session_log_list(PDO $pdo): void {
    require_operator_key($pdo);
    $stmt = $pdo->query('SELECT id, session_id, created_at, level, text FROM session_log
        ORDER BY id DESC LIMIT ' . SESSION_LOG_LIST_LIMIT);
    $entries = array_map(static fn(array $row): array => [
        'id' => (int)$row['id'],
        'session_id' => (int)$row['session_id'],
        'created_at' => (string)$row['created_at'],
        'level' => (string)$row['level'],
        'text' => (string)$row['text'],
    ], $stmt->fetchAll());
    respond_json(200, ['entries' => $entries, 'limit' => SESSION_LOG_LIST_LIMIT]);
}
