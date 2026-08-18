<?php
declare(strict_types=1);

// Tokens are deliberately short (4 hex chars) so players can type them in-game.
function session_token(): string {
    return bin2hex(random_bytes(2));
}

function auth_client_key(bool $writeAccess, ?string $token = null): string {
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'local');
    return hash('sha256', $ip . '|' . ($writeAccess ? 'write' : 'read') . '|' . strtolower(trim((string)$token)));
}

function guard_auth_rate_limit(PDO $pdo, bool $writeAccess, ?string $token): void {
    $key = auth_client_key($writeAccess, $token);
    $stmt = $pdo->prepare('SELECT blocked_until, TIMESTAMPDIFF(SECOND, NOW(), blocked_until) AS retry_after
        FROM auth_rate_limits WHERE client_key = ?');
    $stmt->execute([$key]);
    $row = $stmt->fetch();
    if ($row && $row['blocked_until'] !== null && (int)$row['retry_after'] > 0) {
        header('Retry-After: ' . (int)$row['retry_after']);
        respond_json(429, ['error' => 'Zu viele fehlgeschlagene Verbindungsversuche. Bitte später erneut versuchen.']);
    }
}

function record_auth_failure(PDO $pdo, bool $writeAccess, ?string $token): void {
    $key = auth_client_key($writeAccess, $token);
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

function clear_auth_failures(PDO $pdo, bool $writeAccess, ?string $token): void {
    $stmt = $pdo->prepare('DELETE FROM auth_rate_limits WHERE client_key = ?');
    $stmt->execute([auth_client_key($writeAccess, $token)]);
}

function require_session(PDO $pdo, ?string $token, ?string $pin = null, bool $enforce_pin = false): array {
    if (!$token) {
        respond_json(400, ['error' => 'Missing session_token']);
    }

    // Ein Session-Code kann bereits vor dem eigentlichen Spielstart bekannt sein.
    // Solange der Adapter noch nicht synchronisiert hat, ist das kein Login-Fehler.
    $stmt = $pdo->prepare('SELECT * FROM sessions WHERE token = ?');
    $stmt->execute([$token]);
    $session = $stmt->fetch();
    if (!$session) {
        respond_json(404, ['error' => 'Session not found. Waiting for initial sync.']);
    }

    if ($enforce_pin) {
        $storedPin = $session['pin'];
        $pinMatches = $storedPin === null
            ? !REQUIRE_SESSION_PIN
            : hash_equals((string)$storedPin, (string)$pin);
        if (!$pinMatches) {
            guard_auth_rate_limit($pdo, true, $token);
            record_auth_failure($pdo, true, $token);
            error_log(sprintf(
                '[aublst] auth failure: falsche PIN fuer Session %s von %s',
                $token,
                $_SERVER['REMOTE_ADDR'] ?? 'local'
            ));
            respond_json(401, ['error' => 'Unauthorized! The correct pin is required to execute this action.']);
        }
        clear_auth_failures($pdo, true, $token);
    }

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
