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
    // Shared hosting often enables PHP or compression buffers that ignore a
    // plain flush(). Disable what PHP lets us change and drain active buffers.
    @ini_set('zlib.output_compression', '0');
    @ini_set('output_buffering', '0');
    @ini_set('implicit_flush', '1');
    header('Content-Type: text/event-stream; charset=utf-8');
    header('Cache-Control: no-cache, no-transform');
    header('X-Accel-Buffering: no');
    header('X-Content-Type-Options: nosniff');
    send_cors_headers();

    while (ob_get_level() > 0) {
        if (!@ob_end_flush()) {
            @ob_flush();
            break;
        }
    }
    ob_implicit_flush(true);

    $sendFrame = static function (string $frame): void {
        echo $frame;
        // Some shared-hosting proxies release a response only after 4 KiB.
        // SSE clients ignore comment lines, so padding keeps every frame live.
        $paddingLength = max(0, 4096 - strlen($frame));
        if ($paddingLength > 0) {
            echo ': ' . str_repeat(' ', $paddingLength) . "\n\n";
        }
        if (ob_get_level() > 0) @ob_flush();
        flush();
    };

    $revisionQuery = $pdo->prepare('SELECT revision FROM sessions WHERE id = ?');
    $deadline = microtime(true) + 25.0;
    $nextHeartbeat = 0.0;
    $sendFrame("retry: 1500\n\n");

    while (!connection_aborted() && microtime(true) < $deadline) {
        $revisionQuery->execute([$sid]);
        $revision = $revisionQuery->fetchColumn();
        if ($revision === false) break;
        $revision = (int)$revision;
        if ($revision !== $lastRevision) {
            $sendFrame(
                "event: change\n"
                . 'data: ' . json_encode(['revision' => $revision]) . "\n\n"
            );
            $lastRevision = $revision;
            $nextHeartbeat = microtime(true) + 10.0;
        } elseif (microtime(true) >= $nextHeartbeat) {
            $sendFrame(": heartbeat\n\n");
            $nextHeartbeat = microtime(true) + 10.0;
        }
        usleep(500000);
    }
    exit;
}
