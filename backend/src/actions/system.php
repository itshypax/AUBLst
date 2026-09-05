<?php
declare(strict_types=1);

function action_capabilities(PDO $pdo): void {
    respond_json(200, [
        'api_version' => 1,
        'realtime' => ENABLE_REALTIME_STREAM ? 'sse' : 'polling',
        'revision_cache' => revision_cache_available(),
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

// Betreiberansicht: Tagesaggregate der letzten Tage, nur mit OPERATOR_KEY.
// Fehlversuche laufen über dieselbe Sperre wie falsche PINs.
const METRICS_SUMMARY_DAYS = 30;

function action_metrics_summary(PDO $pdo): void {
    if (OPERATOR_KEY === '') {
        respond_json(404, ['error' => 'Die Betreiberansicht ist nicht eingerichtet (OPERATOR_KEY fehlt).']);
    }
    $data = get_json_input();
    $key = trim((string)($data['operator_key'] ?? ''));
    guard_auth_rate_limit($pdo, true, 'operator');
    if ($key === '' || !hash_equals(OPERATOR_KEY, $key)) {
        record_auth_failure($pdo, true, 'operator');
        respond_json(403, ['error' => 'Der Betreiber-Schlüssel stimmt nicht.']);
    }
    clear_auth_failures($pdo, true, 'operator');

    $stmt = $pdo->query('SELECT metric_day, metric_name, sample_count, value_sum, value_max
        FROM anonymous_metrics
        WHERE metric_day >= DATE_SUB(CURDATE(), INTERVAL ' . METRICS_SUMMARY_DAYS . ' DAY)
        ORDER BY metric_day DESC, metric_name');
    respond_json(200, [
        'enabled' => ENABLE_ANONYMOUS_METRICS,
        'days_back' => METRICS_SUMMARY_DAYS,
        'days' => metrics_summary_days($stmt->fetchAll()),
    ]);
}

// Eine Zeile je Tag mit den Messwerten als Unterschlüssel; Mittelwert gleich hier gerechnet.
function metrics_summary_days(array $rows): array {
    $days = [];
    foreach ($rows as $row) {
        $day = (string)$row['metric_day'];
        if (!isset($days[$day])) $days[$day] = ['day' => $day, 'metrics' => []];
        $count = (int)$row['sample_count'];
        $sum = (float)$row['value_sum'];
        $days[$day]['metrics'][(string)$row['metric_name']] = [
            'count' => $count,
            'sum' => $sum,
            'average' => $count > 0 ? $sum / $count : 0.0,
            'max' => (float)$row['value_max'],
        ];
    }
    return array_values($days);
}

// Unter dem 60-Sekunden-Timeout üblicher Proxys; der Browser baut die
// Verbindung danach neu auf. Mit Revisionscache reicht ein Blick alle 250 ms,
// ohne Cache bleibt es bei einer Datenbankabfrage pro Sekunde.
const STREAM_LIFETIME_SECONDS = 55;
const STREAM_POLL_CACHED_US = 250000;
const STREAM_POLL_DATABASE_US = 1000000;

function action_stream(PDO $pdo): void {
    if (!ENABLE_REALTIME_STREAM) {
        respond_json(404, ['error' => 'Realtime stream disabled']);
    }
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null);
    $sid = (int)$session['id'];
    $lastRevision = max(-1, (int)($data['last_revision'] ?? -1));
    $lastPositionRevision = max(-1, (int)($data['last_position_revision'] ?? -1));

    ignore_user_abort(true);
    set_time_limit(STREAM_LIFETIME_SECONDS + 5);
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

    $revisionQuery = $pdo->prepare('SELECT revision, position_revision FROM sessions WHERE id = ?');
    $deadline = microtime(true) + STREAM_LIFETIME_SECONDS;
    $nextDatabaseRead = 0.0;
    $pollInterval = revision_cache_available() ? STREAM_POLL_CACHED_US : STREAM_POLL_DATABASE_US;
    $nextHeartbeat = 0.0;
    $sendFrame("retry: 1500\n\n");

    while (!connection_aborted() && microtime(true) < $deadline) {
        $now = microtime(true);
        $cached = $now < $nextDatabaseRead ? revision_cache_fetch($sid) : null;
        if ($cached !== null) {
            [$revision, $positionRevision] = $cached;
        } else {
            $revisionQuery->execute([$sid]);
            $row = $revisionQuery->fetch();
            if ($row === false) break;
            $revision = (int)$row['revision'];
            $positionRevision = (int)($row['position_revision'] ?? 0);
            revision_cache_store($sid, $revision, $positionRevision, true);
            $nextDatabaseRead = $now + REVISION_CACHE_DATABASE_INTERVAL;
        }
        $sent = false;
        if ($revision !== $lastRevision) {
            $sendFrame(
                "event: change\n"
                . 'data: ' . json_encode(['revision' => $revision]) . "\n\n"
            );
            $lastRevision = $revision;
            $sent = true;
        }
        if ($positionRevision !== $lastPositionRevision) {
            $sendFrame(
                "event: positions\n"
                . 'data: ' . json_encode(['position_revision' => $positionRevision]) . "\n\n"
            );
            $lastPositionRevision = $positionRevision;
            $sent = true;
        }
        if ($sent) {
            $nextHeartbeat = microtime(true) + 10.0;
        } elseif (microtime(true) >= $nextHeartbeat) {
            $sendFrame(": heartbeat\n\n");
            $nextHeartbeat = microtime(true) + 10.0;
        }
        usleep($pollInterval);
    }
    exit;
}
