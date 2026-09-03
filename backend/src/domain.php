<?php
declare(strict_types=1);

const UNTRACKED_ALARM_UNITS = ['ASF', 'BSW', 'JA', 'FUSTW', 'TD'];

const AUBLST_BRIDGE_KIND = 'aublst-bridge';

function legacy_bridge_descriptor(): array {
    return [
        'kind' => 'legacy',
        'protocol_version' => 0,
        'app_version' => null,
        'capabilities' => [],
        'seen_at' => null,
    ];
}

function normalize_bridge_descriptor($value): ?array {
    if (!is_array($value) || ($value['kind'] ?? null) !== AUBLST_BRIDGE_KIND) return null;

    $protocolVersion = $value['protocol_version'] ?? null;
    if (!is_int($protocolVersion) || $protocolVersion < 1 || $protocolVersion > 65535) return null;

    $appVersion = $value['app_version'] ?? null;
    if (!is_string($appVersion)) return null;
    $appVersion = trim($appVersion);
    if (!preg_match('/\A[A-Za-z0-9][A-Za-z0-9._+-]{0,63}\z/', $appVersion)) return null;

    $sentCapabilities = $value['capabilities'] ?? null;
    if (!is_array($sentCapabilities) || !array_is_list($sentCapabilities) || count($sentCapabilities) > 32) return null;
    $capabilities = [];
    foreach ($sentCapabilities as $capability) {
        if (!is_string($capability)) return null;
        $capability = trim($capability);
        if (!preg_match('/\A[a-z0-9][a-z0-9._-]{0,63}\z/', $capability)) return null;
        $capabilities[$capability] = true;
    }

    return [
        'kind' => AUBLST_BRIDGE_KIND,
        'protocol_version' => $protocolVersion,
        'app_version' => $appVersion,
        'capabilities' => array_keys($capabilities),
    ];
}

function bridge_descriptor_storage_values(array $descriptor): array {
    return [
        $descriptor['kind'],
        $descriptor['protocol_version'],
        $descriptor['app_version'],
        json_encode($descriptor['capabilities'], JSON_UNESCAPED_SLASHES),
        $descriptor['kind'] === 'legacy' ? null : gmdate('Y-m-d H:i:s'),
    ];
}

function session_bridge_descriptor(array $session): array {
    if (($session['bridge_kind'] ?? 'legacy') === 'legacy') return legacy_bridge_descriptor();

    $capabilities = json_decode((string)($session['bridge_capabilities'] ?? '[]'), true);
    $descriptor = normalize_bridge_descriptor([
        'kind' => $session['bridge_kind'] ?? null,
        'protocol_version' => (int)($session['bridge_protocol_version'] ?? 0),
        'app_version' => $session['bridge_app_version'] ?? null,
        'capabilities' => is_array($capabilities) ? $capabilities : [],
    ]);
    if ($descriptor === null) return legacy_bridge_descriptor();

    $descriptor['seen_at'] = $session['bridge_seen_at'] ?? null;
    return $descriptor;
}

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
