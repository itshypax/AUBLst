<?php
// Nach config.local.php kopieren. Diese Datei wird nicht mit veröffentlicht.
define('DB_HOST', 'localhost');
define('DB_NAME', 'game_ops_dashboard');
define('DB_USER', 'aublst_user');
define('DB_PASS', 'hier-das-datenbankpasswort-eintragen');

define('CORS_ALLOW_ORIGIN', 'https://aublst.hypax.wtf');
define('REQUIRE_SESSION_PIN', true);
define('ENABLE_REALTIME_STREAM', true);
define('ENABLE_ANONYMOUS_METRICS', true);
// Zeitzone für alle Zeitstempel (PHP und Datenbankverbindung).
define('APP_TIMEZONE', 'Europe/Berlin');
