<?php
declare(strict_types=1);

// Tokens are deliberately short (4 hex chars) so players can type them in-game.
function session_token(): string {
    return bin2hex(random_bytes(2));
}

function require_session(PDO $pdo, ?string $token, ?string $pin = null, bool $enforce_pin = false): array {
    if (!$token) {
        respond_json(400, ['error' => 'Missing session_token']);
    }
    if ($enforce_pin) {
        $stmt = $pdo->prepare('SELECT * FROM sessions WHERE token = ? AND (pin = ? OR pin IS NULL)');
        $stmt->execute([$token, $pin]);
    } else {
        $stmt = $pdo->prepare('SELECT * FROM sessions WHERE token = ?');
        $stmt->execute([$token]);
    }
    $session = $stmt->fetch();
    if (!$session && !$enforce_pin) {
        respond_json(404, ['error' => 'Session not found. Initialize with action=sync first.', 'token' => $token]);
    }
    if (!$session && $enforce_pin) {
        respond_json(401, ['error' => 'Unauthorized! The correct pin is required to execute this action.', 'token' => $token]);
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
