<?php
declare(strict_types=1);

// Tokens are deliberately short (4 hex chars) so players can type them in-game.
function session_token(): string {
    return bin2hex(random_bytes(2));
}

function auth_client_key(bool $writeAccess): string {
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'local');
    return hash('sha256', $ip . '|' . ($writeAccess ? 'write' : 'read'));
}

function guard_auth_rate_limit(PDO $pdo, bool $writeAccess): void {
    $key = auth_client_key($writeAccess);
    $stmt = $pdo->prepare('SELECT blocked_until, TIMESTAMPDIFF(SECOND, NOW(), blocked_until) AS retry_after
        FROM auth_rate_limits WHERE client_key = ?');
    $stmt->execute([$key]);
    $row = $stmt->fetch();
    if ($row && $row['blocked_until'] !== null && (int)$row['retry_after'] > 0) {
        header('Retry-After: ' . (int)$row['retry_after']);
        respond_json(429, ['error' => 'Zu viele fehlgeschlagene Verbindungsversuche. Bitte später erneut versuchen.']);
    }
}

function record_auth_failure(PDO $pdo, bool $writeAccess): void {
    $key = auth_client_key($writeAccess);
    $window = (int)AUTH_WINDOW_SECONDS;
    $block = (int)AUTH_BLOCK_SECONDS;
    $maximum = (int)AUTH_MAX_FAILURES;

    $stmt = $pdo->prepare("UPDATE auth_rate_limits
        SET failures = 0, window_started_at = NOW(), blocked_until = NULL
        WHERE client_key = ? AND window_started_at < DATE_SUB(NOW(), INTERVAL $window SECOND)");
    $stmt->execute([$key]);

    $stmt = $pdo->prepare('INSERT INTO auth_rate_limits (client_key, failures)
        VALUES (?, 1)
        ON DUPLICATE KEY UPDATE failures = failures + 1, updated_at = CURRENT_TIMESTAMP');
    $stmt->execute([$key]);

    $stmt = $pdo->prepare("UPDATE auth_rate_limits
        SET blocked_until = DATE_ADD(NOW(), INTERVAL $block SECOND)
        WHERE client_key = ? AND failures >= ?");
    $stmt->execute([$key, $maximum]);
}

function clear_auth_failures(PDO $pdo, bool $writeAccess): void {
    $stmt = $pdo->prepare('DELETE FROM auth_rate_limits WHERE client_key = ?');
    $stmt->execute([auth_client_key($writeAccess)]);
}

function require_session(PDO $pdo, ?string $token, ?string $pin = null, bool $enforce_pin = false): array {
    if (!$token) {
        respond_json(400, ['error' => 'Missing session_token']);
    }
    guard_auth_rate_limit($pdo, $enforce_pin);
    if ($enforce_pin) {
        $pinClause = REQUIRE_SESSION_PIN ? 'pin IS NOT NULL AND pin = ?' : '(pin = ? OR pin IS NULL)';
        $stmt = $pdo->prepare("SELECT * FROM sessions WHERE token = ? AND $pinClause");
        $stmt->execute([$token, $pin]);
    } else {
        $stmt = $pdo->prepare('SELECT * FROM sessions WHERE token = ?');
        $stmt->execute([$token]);
    }
    $session = $stmt->fetch();
    if (!$session && !$enforce_pin) {
        record_auth_failure($pdo, false);
        respond_json(404, ['error' => 'Session not found. Initialize with action=sync first.']);
    }
    if (!$session && $enforce_pin) {
        record_auth_failure($pdo, true);
        respond_json(401, ['error' => 'Unauthorized! The correct pin is required to execute this action.']);
    }
    // Lesezugriffe laufen im Polling alle paar Sekunden. Ein DELETE bei jeder
    // erfolgreichen Abfrage würde daraus unnötige Datenbankschreibvorgänge machen.
    if ($enforce_pin) clear_auth_failures($pdo, true);
    return $session;
}

function create_session(PDO $pdo, ?string $mod_id, ?string $pin, ?array $bounds): array {
    ensure_mod_row($pdo, $mod_id);
    $attempts = 0;
    while ($attempts < 10) {
        $attempts++;
        $token = session_token();
        try {
            if ($bounds) {
                $stmt = $pdo->prepare('INSERT INTO sessions (token, mod_id, pin, min_x, min_y, max_x, max_y) VALUES (?, ?, ?, ?, ?, ?, ?)');
                $stmt->execute([
                    $token,
                    $mod_id,
                    $pin,
                    n($bounds['min_x'] ?? 0),
                    n($bounds['min_y'] ?? 0),
                    n($bounds['max_x'] ?? 1000),
                    n($bounds['max_y'] ?? 1000),
                ]);
            } else {
                $stmt = $pdo->prepare('INSERT INTO sessions (token, mod_id, pin) VALUES (?, ?, ?)');
                $stmt->execute([$token, $mod_id, $pin]);
            }
            $stmt = $pdo->prepare('SELECT * FROM sessions WHERE token = ?');
            $stmt->execute([$token]);
            return $stmt->fetch();
        } catch (PDOException $e) {
            // 1062 = duplicate token, roll a new one
            if (isset($e->errorInfo[1]) && (int)$e->errorInfo[1] === 1062) {
                continue;
            }
            throw $e;
        }
    }
    throw new Exception('Failed to generate a unique session token after multiple attempts.');
}
