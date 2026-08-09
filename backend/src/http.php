<?php
declare(strict_types=1);

function cors_origin_allowed(string $origin, string $configured, string $requestHost): bool {
    if ($origin === '') return true;
    if ($configured === '*') return true;
    if ($configured !== '') {
        $allowed = array_filter(array_map(
            static fn(string $item): string => rtrim(trim($item), '/'),
            explode(',', $configured)
        ));
        return in_array(rtrim($origin, '/'), $allowed, true);
    }

    $originHost = parse_url($origin, PHP_URL_HOST);
    $host = preg_replace('/:\d+$/', '', $requestHost);
    return is_string($originHost) && $originHost !== '' && strcasecmp($originHost, (string)$host) === 0;
}

function current_cors_request_allowed(): bool {
    return cors_origin_allowed(
        (string)($_SERVER['HTTP_ORIGIN'] ?? ''),
        (string)CORS_ALLOW_ORIGIN,
        (string)($_SERVER['HTTP_HOST'] ?? '')
    );
}

function send_cors_headers(): void {
    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($origin !== '' && current_cors_request_allowed()) {
        header('Access-Control-Allow-Origin: ' . (CORS_ALLOW_ORIGIN === '*' ? '*' : $origin));
        header('Vary: Origin');
    }
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
    header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
}

function respond_json(int $code, $data): void {
    http_response_code($code);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
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
