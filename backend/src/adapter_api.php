<?php
declare(strict_types=1);

// Adapter-API v1 unter adapter.php/v1/…: feste Pfade, der Sitzungscode steht im
// Header und damit in keinem Zugriffslog. Jede Route läuft auf dieselbe Action wie
// api.php?action=…, dort bleiben ältere Adapter. Vertrag: backend/adapter-api.yaml.
const ADAPTER_API_VERSION = 1;
const ADAPTER_ROUTES = [
    'POST /v1/sessions' => ['session_create', false],
    'POST /v1/session/sync' => ['sync', true],
    'GET /v1/session/commands' => ['commands_pending', true],
    'POST /v1/session/commands/ack' => ['commands_ack', true],
    'POST /v1/session/log' => ['adapter_log', true],
];

// Liefert [Action, braucht Sitzungscode] oder [HTTP-Status, Fehlertext].
function adapter_route(string $method, string $path): array {
    $path = '/' . trim($path, '/');
    $route = ADAPTER_ROUTES[strtoupper($method) . ' ' . $path] ?? null;
    if ($route !== null) return $route;
    foreach (array_keys(ADAPTER_ROUTES) as $key) {
        if (substr($key, strpos($key, ' ') + 1) === $path) return [405, 'Methode nicht erlaubt'];
    }
    return [404, 'Unbekannter Pfad'];
}

function bearer_token(string $header): ?string {
    return preg_match('/^Bearer\s+([0-9a-fA-F]+)$/', trim($header), $m) ? strtolower($m[1]) : null;
}

// Mit mod_php fehlt Authorization je nach Einrichtung in $_SERVER, getallheaders() hat es.
function request_authorization_header(): string {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($header === '' && function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strcasecmp($name, 'Authorization') === 0) return (string)$value;
        }
    }
    return (string)$header;
}
