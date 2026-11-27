<?php
declare(strict_types=1);

// Befehle für Submods ab Code 500. Die Leitstelle schickt sie nur, wenn Adapter
// und Mod sie gemeldet haben. Alte Adapter und die originale AUBMP bekommen so
// nie etwas, das sie nicht kennen.

// 505 Klinik zuweisen, 506 Sprechaufforderung (J). 501 schaltet frei.
const GAME_COMMAND_CODES = [505, 506];
// Länger still, und der Adapter gilt als weg: ein J käme sonst Minuten später an.
const GAME_COMMAND_ADAPTER_MAX_AGE = 15;
const GAME_COMMAND_SYNC_SECONDS = 30;
const GAME_COMMAND_FIELD_MAX = 64;

function game_command_enabled(array $session, int $code, DateTimeImmutable $now): bool {
    $status = adapter_status_view($session, $now);
    if ($status === null || $status['age'] > GAME_COMMAND_ADAPTER_MAX_AGE) return false;
    if (($status['game_command'] ?? 0) < 1) return false;
    return in_array($code, $status['game_features']['commands'] ?? [], true);
}

// Die Mod trennt Felder mit | und Befehle mit Zeilenumbrüchen.
function game_command_fields_valid(array $fields): bool {
    foreach ($fields as $field) {
        if (!is_int($field) && !is_string($field)) return false;
        $text = (string)$field;
        if (mb_strlen($text) > GAME_COMMAND_FIELD_MAX || preg_match('/[|\r\n]/', $text)) return false;
    }
    return true;
}

// Ein Abgleich: 501 mit den Codes, die beide Seiten können, danach jede offene
// Klinikvormerkung. Die Mod löscht beim 501 alle Klinik-Merker und setzt sie
// aus den folgenden 505 neu, so kommen auch Löschungen der Leitstelle an.
function game_sync_payloads(array $announced, array $reservations): array {
    if (!in_array(501, $announced, true)) return [];
    $codes = array_values(array_intersect(GAME_COMMAND_CODES, $announced));
    $payloads = [['code' => 501, 'fields' => [implode(',', $codes)]]];
    if (!in_array(505, $codes, true)) return $payloads;
    foreach ($reservations as $reservation) {
        if (($reservation['status'] ?? '') !== 'reserved') continue;
        $payloads[] = ['code' => 505, 'fields' => [(string)$reservation['game_vehicle_id'], (int)$reservation['game_hospital_id']]];
    }
    return $payloads;
}

function insert_game_command(PDO $pdo, int $session_id, int $code, array $fields): bool {
    if (!game_command_fields_valid($fields)) return false;
    insert_command($pdo, $session_id, 'game_command', ['code' => $code, 'fields' => array_values($fields)]);
    return true;
}
