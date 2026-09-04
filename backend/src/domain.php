<?php
declare(strict_types=1);

const UNTRACKED_ALARM_UNITS = ['ASF', 'BSW', 'JA', 'FUSTW', 'TD'];

function valid_vehicle_status($status): bool {
    return is_numeric($status) && (int)$status >= 0 && (int)$status <= 9;
}

function normalized_vehicle_markers(array $vehicle): array {
    return array_map(
        static fn($value): string => strtoupper(trim((string)$value)),
        [$vehicle['game_vehicle_id'] ?? '', $vehicle['type'] ?? '']
    );
}

function is_untracked_alarm_unit(array $vehicle): bool {
    foreach (normalized_vehicle_markers($vehicle) as $marker) {
        if (in_array($marker, UNTRACKED_ALARM_UNITS, true)) return true;
    }
    return false;
}

function vehicle_available_for_alarm(array $vehicle): bool {
    return is_untracked_alarm_unit($vehicle) || in_array((int)($vehicle['status'] ?? -1), [1, 2], true);
}

function vehicle_supports_multiple_assignments(array $vehicle): bool {
    return is_untracked_alarm_unit($vehicle);
}

function is_hospital_transport_vehicle(array $vehicle): bool {
    $text = strtoupper(implode(' ', array_filter([
        $vehicle['game_vehicle_id'] ?? null,
        $vehicle['name'] ?? null,
        $vehicle['type'] ?? null,
    ])));
    return preg_match('/(^|[^A-Z])(RTW|ITW)([^A-Z]|$)/', $text) === 1;
}

function hospital_reservation_can_be_created(array $vehicle, bool $hasReservation): bool {
    return $hasReservation || in_array((int)($vehicle['status'] ?? -1), [4, 5, 7], true);
}

function hospital_reservation_should_clear($status): bool {
    return in_array((int)$status, [1, 2], true);
}

function vehicle_has_incident_type(array $vehicle, string $type): bool {
    $text = strtoupper(implode(' ', array_filter([
        $vehicle['game_vehicle_id'] ?? null,
        $vehicle['name'] ?? null,
        $vehicle['type'] ?? null,
    ])));
    return preg_match('/(^|[^A-Z])' . preg_quote(strtoupper($type), '/') . '([^A-Z]|$)/', $text) === 1;
}

function is_rescue_incident_vehicle(array $vehicle): bool {
    foreach (['RTW', 'KTW', 'NKTW', 'GRTW', 'ITW', 'NEF', 'NAW', 'RTH', 'ITH', 'CHRISTOPH', 'GWSAN', 'GWRH'] as $type) {
        if (vehicle_has_incident_type($vehicle, $type)) return true;
    }
    return false;
}

function is_physician_staffed_incident_vehicle(array $vehicle): bool {
    foreach (['NEF', 'NAW', 'ITW', 'RTH', 'ITH', 'CHRISTOPH'] as $type) {
        if (vehicle_has_incident_type($vehicle, $type)) return true;
    }
    return false;
}

function select_medical_incident_leader(array $vehicles): ?int {
    $rtwCount = count(array_filter(
        $vehicles,
        static fn(array $vehicle): bool => vehicle_has_incident_type($vehicle, 'RTW')
    ));
    $physicianCount = count(array_filter($vehicles, 'is_physician_staffed_incident_vehicle'));
    if ($rtwCount < 3 && $physicianCount < 2) return null;

    $eligible = array_values(array_filter($vehicles, static function (array $vehicle): bool {
        return in_array((int)($vehicle['status'] ?? -1), [3, 4], true)
            && !empty($vehicle['first_status_4_at']);
    }));
    usort($eligible, static function (array $left, array $right): int {
        return strcmp((string)$left['first_status_4_at'], (string)$right['first_status_4_at'])
            ?: ((int)$left['id'] <=> (int)$right['id']);
    });

    foreach ($eligible as $vehicle) {
        if (is_physician_staffed_incident_vehicle($vehicle)) return (int)$vehicle['id'];
    }
    foreach ($eligible as $vehicle) {
        if (vehicle_has_incident_type($vehicle, 'RTW')) return (int)$vehicle['id'];
    }
    return null;
}

function normalized_incident_vehicle_id(array $vehicle): string {
    $identifier = trim((string)($vehicle['game_vehicle_id'] ?? ''));
    if ($identifier === '') $identifier = trim((string)($vehicle['name'] ?? ''));
    return trim((string)preg_replace('/[^A-Z0-9]+/', '_', strtoupper($identifier)), '_');
}

function select_fire_incident_leader(array $vehicles): ?int {
    $eligible = array_values(array_filter($vehicles, static function (array $vehicle): bool {
        return in_array((int)($vehicle['status'] ?? -1), [3, 4], true)
            && !empty($vehicle['first_status_4_at']);
    }));
    usort($eligible, static function (array $left, array $right): int {
        return strcmp((string)$left['first_status_4_at'], (string)$right['first_status_4_at'])
            ?: ((int)$left['id'] <=> (int)$right['id']);
    });

    foreach (['1_KDOW_1', '4_ELW_1'] as $commandVehicleId) {
        foreach ($eligible as $vehicle) {
            if (normalized_incident_vehicle_id($vehicle) === $commandVehicleId) return (int)$vehicle['id'];
        }
    }
    foreach ($eligible as $vehicle) {
        if (vehicle_has_incident_type($vehicle, 'ELW')) return (int)$vehicle['id'];
    }
    foreach ($eligible as $vehicle) {
        if (vehicle_has_incident_type($vehicle, 'HLF')) return (int)$vehicle['id'];
    }
    return null;
}

// Der Sync erhöht die Revision spätestens nach dieser Zeit auch ohne
// erkennbare Änderung, damit Leitstellen nach Änderungen, die nur in der
// Datenbank passiert sind, sicher wieder auf Stand kommen.
const SYNC_REVISION_MAX_AGE_SECONDS = 15;

// Welche Art von Änderung ein Fahrzeugupdate enthält. $row ist die Zeile,
// wie sie gespeichert wird (fehlende Felder sind bereits aus $saved ergänzt).
function vehicle_change_kinds($saved, array $row): array {
    if (!$saved) return ['positions' => true, 'data' => true];
    $positions = (float)$saved['x'] !== (float)$row['x'] || (float)$saved['y'] !== (float)$row['y'];
    $data = (int)$saved['status'] !== (int)$row['status'];
    foreach (['name', 'type', 'modes'] as $field) {
        if ((string)($saved[$field] ?? '') !== (string)($row[$field] ?? '')) $data = true;
    }
    return ['positions' => $positions, 'data' => $data];
}

// Fingerabdruck über den Sync-Inhalt ohne Fahrzeugpositionen. Bleibt er
// gleich, hat sich außer Positionen nichts geändert und die Zustandsrevision
// muss nicht steigen.
function sync_fingerprint(array $data): string {
    $vehicles = [];
    foreach (($data['vehicles'] ?? []) as $vehicle) {
        if (!is_array($vehicle)) continue;
        $id = trim((string)($vehicle['game_vehicle_id'] ?? ''));
        if ($id === '') continue;
        unset($vehicle['x'], $vehicle['y']);
        ksort($vehicle);
        $vehicles[$id] = $vehicle;
    }
    ksort($vehicles);
    $payload = [
        'players' => $data['players'] ?? null,
        'hospitals' => $data['hospitals'] ?? null,
        'messages' => $data['messages'] ?? null,
        'events' => $data['events'] ?? null,
        'time' => $data['time'] ?? null,
        'map_bounds' => $data['map_bounds'] ?? null,
        'vehicles' => $vehicles,
    ];
    return hash('sha256', (string)json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}
