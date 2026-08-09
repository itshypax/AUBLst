<?php
declare(strict_types=1);

function action_update_hospitals(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null);
    $sid = $session['id'];

    foreach (($data['updates'] ?? []) as $h) {
        upsert_hospital($pdo, $sid, $h);
    }
    respond_json(200, ['ok' => true]);
}

function action_hospital_reservation_set(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null, $data['pin'] ?? null, true);
    $sid = $session['id'];
    $vehicle_id = (int)($data['vehicle_id'] ?? 0);
    $hospital_id = (int)($data['hospital_id'] ?? 0);
    $bed_type = (string)($data['bed_type'] ?? '');
    if (!$vehicle_id || !$hospital_id || !in_array($bed_type, ['ward', 'icu'], true)) {
        respond_json(400, ['error' => 'Fahrzeug, Klinik und Bettenart werden benötigt.']);
    }

    $stmt = $pdo->prepare('SELECT * FROM vehicles WHERE session_id = ? AND id = ?');
    $stmt->execute([$sid, $vehicle_id]);
    $vehicle = $stmt->fetch();
    if (!$vehicle) {
        respond_json(404, ['error' => 'Fahrzeug nicht gefunden.']);
    }
    $vehicle_text = strtoupper(implode(' ', array_filter([
        $vehicle['game_vehicle_id'] ?? null, $vehicle['name'] ?? null, $vehicle['type'] ?? null,
    ])));
    if (!preg_match('/(^|[^A-Z])(RTW|ITW)([^A-Z]|$)/', $vehicle_text)) {
        respond_json(400, ['error' => 'Eine Klinik kann nur einem RTW oder ITW zugewiesen werden.']);
    }
    $stmt = $pdo->prepare("SELECT id FROM hospital_reservations WHERE session_id = ? AND vehicle_id = ? AND status = 'reserved'");
    $stmt->execute([$sid, $vehicle_id]);
    $has_reservation = (bool)$stmt->fetchColumn();
    if (!in_array((int)$vehicle['status'], [4, 5, 7], true) && !$has_reservation) {
        respond_json(409, ['error' => 'Eine neue Klinikzuweisung ist für RTW und ITW in Status 4, 5 oder 7 möglich.']);
    }

    $stmt = $pdo->prepare('SELECT * FROM hospitals WHERE session_id = ? AND id = ?');
    $stmt->execute([$sid, $hospital_id]);
    $hospital = $stmt->fetch();
    if (!$hospital) respond_json(404, ['error' => 'Klinik nicht gefunden.']);

    $available_column = $bed_type === 'icu' ? 'icu_available' : 'ward_available';
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM hospital_reservations
        WHERE session_id = ? AND hospital_id = ? AND bed_type = ? AND vehicle_id <> ?');
    $stmt->execute([$sid, $hospital_id, $bed_type, $vehicle_id]);
    $reserved_elsewhere = (int)$stmt->fetchColumn();
    if ((int)$hospital[$available_column] - $reserved_elsewhere <= 0) {
        respond_json(409, ['error' => 'In dieser Kategorie ist aktuell kein Platz mehr frei.']);
    }

    $stmt = $pdo->prepare("INSERT INTO hospital_reservations
        (session_id, vehicle_id, hospital_id, bed_type, status, baseline_available)
        VALUES (?, ?, ?, ?, 'reserved', ?)
        ON DUPLICATE KEY UPDATE hospital_id = VALUES(hospital_id), bed_type = VALUES(bed_type),
            status = 'reserved', baseline_available = VALUES(baseline_available), arrived_at = NULL,
            updated_at = CURRENT_TIMESTAMP");
    $stmt->execute([$sid, $vehicle_id, $hospital_id, $bed_type, (int)$hospital[$available_column]]);
    respond_json(200, ['ok' => true]);
}

function action_hospital_reservation_clear(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null, $data['pin'] ?? null, true);
    $sid = $session['id'];
    $vehicle_id = (int)($data['vehicle_id'] ?? 0);
    if (!$vehicle_id) respond_json(400, ['error' => 'Fahrzeug fehlt.']);
    $stmt = $pdo->prepare('DELETE FROM hospital_reservations WHERE session_id = ? AND vehicle_id = ?');
    $stmt->execute([$sid, $vehicle_id]);
    respond_json(200, ['ok' => true]);
}
