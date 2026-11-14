<?php
declare(strict_types=1);

// Einstieg der Adapter-API v1, z. B. POST /backend/adapter.php/v1/session/sync.
// Löst den Pfad in eine Action auf und übergibt an api.php, damit beide Wege
// denselben Code nehmen.
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/src/http.php';
require_once __DIR__ . '/src/adapter_api.php';

[$action, $needsToken] = adapter_route((string)$_SERVER['REQUEST_METHOD'], (string)($_SERVER['PATH_INFO'] ?? '/'));
if (is_int($action)) {
    respond_json($action, ['error' => $needsToken]);
}
if ($needsToken) {
    $token = bearer_token(request_authorization_header());
    if ($token === null) {
        respond_json(401, ['error' => 'Header "Authorization: Bearer <Sitzungscode>" fehlt']);
    }
    request_session_token($token);
    $_GET['session_token'] = $token;
}
$_GET['action'] = $action;
require __DIR__ . '/api.php';
