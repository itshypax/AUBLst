<?php
declare(strict_types=1);

function send_cors_headers(): void {
    header('Access-Control-Allow-Origin: ' . CORS_ALLOW_ORIGIN);
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
    header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
}

function respond_json(int $code, $data): void {
    http_response_code($code);
    header('Content-Type: application/json');
    send_cors_headers();
    echo json_encode($data);
    exit;
}

function get_json_input(): array {
    static $cached = null;
    if ($cached !== null) return $cached;
    $raw = file_get_contents('php://input');
    if (trim($raw) === '') return $cached = [];
    $data = json_decode($raw, true);
    if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
        respond_json(400, ['error' => 'Invalid JSON']);
    }
    return $cached = ($data ?: []);
}

function request_value(string $key, $default = null) {
    if (array_key_exists($key, $_GET)) return $_GET[$key];
    if (array_key_exists($key, $_POST)) return $_POST[$key];
    $data = get_json_input();
    return $data[$key] ?? $default;
}

function n($v) {
    return is_null($v) ? null : 0 + $v;
}
