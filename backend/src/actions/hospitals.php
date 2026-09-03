<?php
declare(strict_types=1);

function action_update_hospitals(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null);
    $sid = $session['id'];

    foreach (($data['updates'] ?? []) as $h) {
        upsert_hospital($pdo, $sid, $h);
    }
    touch_session($pdo, $sid);
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
    if (!is_hospital_transport_vehicle($vehicle)) {
        respond_json(400, ['error' => 'Eine Klinik kann nur einem RTW oder ITW zugewiesen werden.']);
    }
    $stmt = $pdo->prepare("SELECT id FROM hospital_reservations WHERE session_id = ? AND vehicle_id = ? AND status = 'reserved'");
    $stmt->execute([$sid, $vehicle_id]);
    $has_reservation = (bool)$stmt->fetchColumn();
    if (!hospital_reservation_can_be_created($vehicle, $has_reservation)) {
        respond_json(409, ['error' => 'Eine neue Klinikzuweisung ist für RTW und ITW in Status 4, 5 oder 7 möglich.']);
    }

    $stmt = $pdo->prepare('SELECT * FROM hospitals WHERE session_id = ? AND id = ?');
    $stmt->execute([$sid, $hospital_id]);
    $hospital = $stmt->fetch();
    if (!$hospital) respond_json(404, ['error' => 'Klinik nicht gefunden.']);

    $available_column = $bed_type === 'icu' ? 'icu_available' : 'ward_available';
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM hospital_reservations r
        JOIN vehicles v ON v.id = r.vehicle_id AND v.session_id = r.session_id
        WHERE r.session_id = ? AND r.hospital_id = ? AND r.bed_type = ? AND r.vehicle_id <> ?
          AND (r.status = 'reserved' OR (r.status = 'arrived' AND v.status = 8))");
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
    $vehicleLabel = trim((string)($vehicle['name'] ?? '')) ?: (string)$vehicle['game_vehicle_id'];
    $hospitalLabel = trim((string)($hospital['name'] ?? '')) ?: 'Klinik #' . $hospital_id;
    record_vehicle_event_journal(
        $pdo,
        $sid,
        $vehicle_id,
        'hospital_assigned',
        $vehicleLabel . ' für ' . $hospitalLabel . ' vorgemerkt (' . ($bed_type === 'icu' ? 'Intensiv' : 'Normal') . ')'
    );
    touch_session($pdo, $sid);
    respond_json(200, ['ok' => true]);
}

function action_hospital_reservation_clear(PDO $pdo): void {
    $data = get_json_input();
    $session = require_session($pdo, $data['session_token'] ?? null, $data['pin'] ?? null, true);
    $sid = $session['id'];
    $vehicle_id = (int)($data['vehicle_id'] ?? 0);
    if (!$vehicle_id) respond_json(400, ['error' => 'Fahrzeug fehlt.']);
    $vehicle = $pdo->prepare('SELECT game_vehicle_id, name FROM vehicles WHERE session_id = ? AND id = ?');
    $vehicle->execute([$sid, $vehicle_id]);
    $vehicle = $vehicle->fetch();
    $stmt = $pdo->prepare('DELETE FROM hospital_reservations WHERE session_id = ? AND vehicle_id = ?');
    $stmt->execute([$sid, $vehicle_id]);
    if ($vehicle) {
        $vehicleLabel = trim((string)($vehicle['name'] ?? '')) ?: (string)$vehicle['game_vehicle_id'];
        record_vehicle_event_journal($pdo, $sid, $vehicle_id, 'hospital_cleared', 'Klinikvormerkung für ' . $vehicleLabel . ' aufgehoben');
    }
    touch_session($pdo, $sid);
    respond_json(200, ['ok' => true]);
}
