<?php
declare(strict_types=1);

function action_capabilities(PDO $pdo): void {
    respond_json(200, [
        'api_version' => 1,
        'realtime' => ENABLE_REALTIME_STREAM ? 'sse' : 'polling',
        'anonymous_metrics' => ENABLE_ANONYMOUS_METRICS,
    ]);
}

function action_metrics_record(PDO $pdo): void {
    if (!ENABLE_ANONYMOUS_METRICS) {
        respond_json(200, ['ok' => true, 'recorded' => false]);
    }

    $data = get_json_input();
    require_session($pdo, $data['session_token'] ?? null);
    $metrics = is_array($data['metrics'] ?? null) ? $data['metrics'] : [];
    $allowed = [
        'state_load_ms' => 120000.0,
        'active_events' => 10000.0,
    ];
    $recorded = [];
    foreach ($allowed as $name => $maximum) {
        if (!array_key_exists($name, $metrics) || !is_numeric($metrics[$name])) continue;
        $value = max(0.0, min($maximum, (float)$metrics[$name]));
        record_anonymous_metric($pdo, $name, $value);
        $recorded[] = $name;
    }
    respond_json(200, ['ok' => true, 'recorded' => $recorded]);
}

function action_stream(PDO $pdo): void {
    if (!ENABLE_REALTIME_STREAM) {
        respond_json(404, ['error' => 'Realtime stream disabled']);
    }
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null);
    $sid = (int)$session['id'];
    $lastRevision = max(-1, (int)($data['last_revision'] ?? -1));

    ignore_user_abort(true);
    set_time_limit(30);
    header('Content-Type: text/event-stream; charset=utf-8');
    header('Cache-Control: no-cache, no-transform');
    header('X-Accel-Buffering: no');
    header('X-Content-Type-Options: nosniff');
    send_cors_headers();

    $revisionQuery = $pdo->prepare('SELECT revision FROM sessions WHERE id = ?');
    $deadline = microtime(true) + 25.0;
    $nextHeartbeat = 0.0;
    echo "retry: 1500\n\n";
    if (ob_get_level() > 0) @ob_flush();
    flush();

    while (!connection_aborted() && microtime(true) < $deadline) {
        $revisionQuery->execute([$sid]);
        $revision = $revisionQuery->fetchColumn();
        if ($revision === false) break;
        $revision = (int)$revision;
        if ($revision !== $lastRevision) {
            echo "event: change\n";
            echo 'data: ' . json_encode(['revision' => $revision]) . "\n\n";
            $lastRevision = $revision;
            $nextHeartbeat = microtime(true) + 10.0;
        } elseif (microtime(true) >= $nextHeartbeat) {
            echo ": heartbeat\n\n";
            $nextHeartbeat = microtime(true) + 10.0;
        }
        if (ob_get_level() > 0) @ob_flush();
        flush();
        usleep(500000);
    }
    exit;
}
