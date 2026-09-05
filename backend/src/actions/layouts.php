<?php
declare(strict_types=1);

// Server-Bibliothek für Arbeitsansichten. Layouts hängen an keiner Sitzung:
// Wer den Code hat, kann laden, überschreiben und löschen. Lesen braucht eine
// gültige Sitzung, Schreiben zusätzlich die PIN (über DISPATCHER_WRITE_ACTIONS).

const LAYOUT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LAYOUT_CODE_LENGTH = 6;
const LAYOUT_MAX_BYTES = 65536;
const LAYOUT_NAME_MAX = 60;

function layout_code(): string {
    $code = '';
    $max = strlen(LAYOUT_CODE_ALPHABET) - 1;
    for ($i = 0; $i < LAYOUT_CODE_LENGTH; $i++) {
        $code .= LAYOUT_CODE_ALPHABET[random_int(0, $max)];
    }
    return $code;
}

function normalize_layout_code($value): ?string {
    $code = strtoupper(trim((string)$value));
    return preg_match('/^[A-Z0-9]{' . LAYOUT_CODE_LENGTH . '}$/', $code) === 1 ? $code : null;
}

function normalize_layout_name($value): string {
    $name = trim((string)$value);
    $name = preg_replace('/\s+/u', ' ', $name) ?? $name;
    return $name === '' ? 'Unbenannte Ansicht' : mb_substr($name, 0, LAYOUT_NAME_MAX);
}

// Liefert eine Fehlermeldung oder null. Die Struktur prüft das Frontend beim
// Laden noch einmal, hier geht es um Form und Größe.
function validate_layout_payload($layout): ?string {
    if (!is_array($layout) || !isset($layout['panels']) || !is_array($layout['panels'])) {
        return 'Das Layout muss eine Fensterliste (panels) enthalten.';
    }
    if (!$layout['panels']) return 'Das Layout enthält keine Fenster.';
    $encoded = json_encode($layout);
    if ($encoded === false) return 'Das Layout lässt sich nicht speichern.';
    if (strlen($encoded) > LAYOUT_MAX_BYTES) return 'Das Layout ist zu groß.';
    return null;
}

function layout_row_to_summary(array $row): array {
    return [
        'code' => $row['code'],
        'name' => $row['name'],
        'mod_id' => $row['mod_id'],
        'updated_at' => $row['updated_at'],
    ];
}

function action_layouts_list(PDO $pdo): void {
    require_session($pdo, request_value('session_token'));
    $stmt = $pdo->query('SELECT code, name, mod_id, updated_at FROM layouts ORDER BY updated_at DESC, id DESC LIMIT 200');
    respond_json(200, ['layouts' => array_map('layout_row_to_summary', $stmt->fetchAll())]);
}

function action_layouts_get(PDO $pdo): void {
    require_session($pdo, request_value('session_token'));
    $code = normalize_layout_code(request_value('code'));
    if ($code === null) respond_json(400, ['error' => 'Ungültiger Layout-Code.']);
    $stmt = $pdo->prepare('SELECT code, name, mod_id, layout, updated_at FROM layouts WHERE code = ?');
    $stmt->execute([$code]);
    $row = $stmt->fetch();
    if (!$row) respond_json(404, ['error' => 'Kein Layout mit diesem Code.']);
    $layout = json_decode((string)$row['layout'], true);
    respond_json(200, layout_row_to_summary($row) + ['layout' => is_array($layout) ? $layout : null]);
}

function action_layouts_put(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null, $data['pin'] ?? null, true);
    $name = normalize_layout_name($data['name'] ?? '');
    $layout = $data['layout'] ?? null;
    $error = validate_layout_payload($layout);
    if ($error !== null) respond_json(400, ['error' => $error]);
    $encoded = json_encode($layout, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $mod_id = $session['mod_id'] ?? null;

    $code = normalize_layout_code($data['code'] ?? '');
    if ($code !== null) {
        $update = $pdo->prepare('UPDATE layouts SET name = ?, mod_id = ?, layout = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?');
        $update->execute([$name, $mod_id, $encoded, $code]);
        if ($update->rowCount() > 0 || layout_exists($pdo, $code)) {
            respond_json(200, ['ok' => true, 'code' => $code, 'name' => $name, 'created' => false]);
        }
    }

    // Neuer Code; bei der seltenen Kollision einfach noch einmal würfeln.
    $insert = $pdo->prepare('INSERT INTO layouts (code, name, mod_id, layout) VALUES (?, ?, ?, ?)');
    for ($attempt = 0; $attempt < 5; $attempt++) {
        $code = layout_code();
        try {
            $insert->execute([$code, $name, $mod_id, $encoded]);
            respond_json(200, ['ok' => true, 'code' => $code, 'name' => $name, 'created' => true]);
        } catch (PDOException $e) {
            if ((int)($e->errorInfo[1] ?? 0) !== 1062) throw $e;
        }
    }
    respond_json(500, ['error' => 'Kein freier Layout-Code gefunden.']);
}

function layout_exists(PDO $pdo, string $code): bool {
    $stmt = $pdo->prepare('SELECT 1 FROM layouts WHERE code = ?');
    $stmt->execute([$code]);
    return (bool)$stmt->fetchColumn();
}

function action_layouts_delete(PDO $pdo): void {
    $data = get_json_input();
    require_session($pdo, $data['session_token'] ?? null, $data['pin'] ?? null, true);
    $code = normalize_layout_code($data['code'] ?? '');
    if ($code === null) respond_json(400, ['error' => 'Ungültiger Layout-Code.']);
    $stmt = $pdo->prepare('DELETE FROM layouts WHERE code = ?');
    $stmt->execute([$code]);
    if ($stmt->rowCount() === 0) respond_json(404, ['error' => 'Kein Layout mit diesem Code.']);
    respond_json(200, ['ok' => true]);
}
