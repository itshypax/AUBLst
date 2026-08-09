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
