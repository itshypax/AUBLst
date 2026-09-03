<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once dirname(__DIR__) . '/config.php';
require_once dirname(__DIR__) . '/src/database.php';

$command = $argv[1] ?? '';
if (!in_array($command, ['migrate', 'cleanup'], true)) {
    fwrite(STDERR, "Aufruf: php backend/bin/maintenance.php migrate|cleanup\n");
    exit(2);
}

$pdo = pdo_conn($command === 'migrate');
if ($command === 'cleanup') {
    $result = cleanup_expired_data($pdo);
    fwrite(STDOUT, "Entfernte Sitzungen: {$result['sessions']}\n");
} else {
    fwrite(STDOUT, "Datenbankschema ist aktuell.\n");
}
