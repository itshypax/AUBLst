<?php
// backend/config.php
// Lokale Zugangsdaten bleiben beim manuellen Deployment unangetastet.
$localConfig = __DIR__ . '/config.local.php';
if (is_file($localConfig)) require_once $localConfig;

if (!function_exists('env_flag')) {
    function env_flag(string $name, bool $default = false): bool {
        $value = getenv($name);
        if ($value === false || trim($value) === '') return $default;
        return filter_var($value, FILTER_VALIDATE_BOOL);
    }
}

if (!defined('DB_HOST')) define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
if (!defined('DB_NAME')) define('DB_NAME', getenv('DB_NAME') ?: 'game_ops_dashboard');
if (!defined('DB_USER')) define('DB_USER', getenv('DB_USER') ?: 'root');
if (!defined('DB_PASS')) define('DB_PASS', getenv('DB_PASS') ?: '');
if (!defined('DB_CHARSET')) define('DB_CHARSET', 'utf8mb4');

// Leer bedeutet: Browserzugriffe nur vom selben Host. Mehrere Origins werden
// kommasepariert angegeben, z. B. https://lst.example.de,https://test.example.de.
if (!defined('CORS_ALLOW_ORIGIN')) define('CORS_ALLOW_ORIGIN', getenv('CORS_ALLOW_ORIGIN') ?: '');
if (!defined('REQUIRE_SESSION_PIN')) define('REQUIRE_SESSION_PIN', env_flag('REQUIRE_SESSION_PIN'));
if (!defined('AUTH_MAX_FAILURES')) define('AUTH_MAX_FAILURES', max(3, (int)(getenv('AUTH_MAX_FAILURES') ?: 12)));
if (!defined('AUTH_WINDOW_SECONDS')) define('AUTH_WINDOW_SECONDS', max(60, (int)(getenv('AUTH_WINDOW_SECONDS') ?: 300)));
if (!defined('AUTH_BLOCK_SECONDS')) define('AUTH_BLOCK_SECONDS', max(60, (int)(getenv('AUTH_BLOCK_SECONDS') ?: 900)));
if (!defined('ENABLE_ANONYMOUS_METRICS')) define('ENABLE_ANONYMOUS_METRICS', env_flag('ENABLE_ANONYMOUS_METRICS', true));
if (!defined('ENABLE_REALTIME_STREAM')) define('ENABLE_REALTIME_STREAM', env_flag('ENABLE_REALTIME_STREAM', true));
if (!defined('STATE_CACHE_SECONDS')) define('STATE_CACHE_SECONDS', max(0, (int)(getenv('STATE_CACHE_SECONDS') ?: 5)));
if (!defined('SESSION_TTL_SECONDS')) define('SESSION_TTL_SECONDS', max(900, (int)(getenv('SESSION_TTL_SECONDS') ?: 3600)));
