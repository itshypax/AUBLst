<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/domain.php';
require_once __DIR__ . '/../src/http.php';
require_once __DIR__ . '/../src/migrations.php';

$tests = [];

function test_case(string $name, callable $test): void {
    global $tests;
    $tests[$name] = $test;
}

function expect_true(bool $value, string $message = 'Erwartung nicht erfüllt'): void {
    if (!$value) throw new RuntimeException($message);
}

function expect_same($expected, $actual, string $message = ''): void {
    if ($expected !== $actual) {
        throw new RuntimeException($message ?: 'Erwartet ' . var_export($expected, true) . ', erhalten ' . var_export($actual, true));
    }
}

test_case('Alarmierung akzeptiert nur verfügbare Status', static function (): void {
    expect_true(vehicle_available_for_alarm(['game_vehicle_id' => '1_HLF_1', 'type' => 'HLF', 'status' => 1]));
    expect_true(vehicle_available_for_alarm(['game_vehicle_id' => '1_HLF_1', 'type' => 'HLF', 'status' => 2]));
    expect_true(!vehicle_available_for_alarm(['game_vehicle_id' => '1_HLF_1', 'type' => 'HLF', 'status' => 4]));
});

test_case('Nicht getrackte Einheiten bleiben alarmierbar', static function (): void {
    expect_true(vehicle_available_for_alarm(['game_vehicle_id' => 'ASF', 'type' => 'ASF', 'status' => 6]));
    expect_true(vehicle_available_for_alarm(['game_vehicle_id' => 'extern', 'type' => 'FUSTW', 'status' => 0]));
});

test_case('Fahrzeugstatus wird vor dem Speichern geprüft', static function (): void {
    expect_true(valid_vehicle_status(0));
    expect_true(valid_vehicle_status('9'));
    expect_true(!valid_vehicle_status(-1));
    expect_true(!valid_vehicle_status(10));
    expect_true(!valid_vehicle_status('C'));
});

test_case('Klinikzuweisung gilt nur für RTW und ITW', static function (): void {
    expect_true(is_hospital_transport_vehicle(['game_vehicle_id' => '4_RTW_B', 'name' => '4-RTW-B', 'type' => '24']));
    expect_true(is_hospital_transport_vehicle(['game_vehicle_id' => '2_ITW_R', 'name' => '2-ITW-R', 'type' => 'ITW']));
    expect_true(!is_hospital_transport_vehicle(['game_vehicle_id' => '4_NEF_A', 'name' => '4-NEF-A', 'type' => 'NEF']));
});

test_case('Klinikvormerkung folgt dem Statusablauf', static function (): void {
    foreach ([4, 5, 7] as $status) {
        expect_true(hospital_reservation_can_be_created(['status' => $status], false));
    }
    expect_true(!hospital_reservation_can_be_created(['status' => 2], false));
    expect_true(hospital_reservation_can_be_created(['status' => 8], true));
    expect_true(!hospital_reservation_should_clear(8));
    expect_true(hospital_reservation_should_clear(1));
    expect_true(hospital_reservation_should_clear(2));
});

test_case('CORS erlaubt standardmäßig nur denselben Host', static function (): void {
    expect_true(cors_origin_allowed('https://aublst.hypax.wtf', '', 'aublst.hypax.wtf'));
    expect_true(!cors_origin_allowed('https://example.org', '', 'aublst.hypax.wtf'));
    expect_true(cors_origin_allowed('https://test.example.org', 'https://aublst.hypax.wtf, https://test.example.org', 'aublst.hypax.wtf'));
});

test_case('Migrationen haben eine feste Reihenfolge', static function (): void {
    $versions = array_keys(migration_definitions());
    $sorted = $versions;
    sort($sorted, SORT_STRING);
    expect_same($sorted, $versions);
    expect_same(count($versions), count(array_unique($versions)));
});

$failed = 0;
foreach ($tests as $name => $test) {
    try {
        $test();
        echo "OK  $name\n";
    } catch (Throwable $error) {
        $failed++;
        fwrite(STDERR, "FEHLER  $name\n  {$error->getMessage()}\n");
    }
}

echo "\n" . count($tests) . ' Tests, ' . $failed . " Fehler\n";
exit($failed === 0 ? 0 : 1);
