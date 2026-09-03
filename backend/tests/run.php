<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/domain.php';
require_once __DIR__ . '/../src/http.php';
require_once __DIR__ . '/../src/migrations.php';
require_once __DIR__ . '/../src/repository.php';
require_once __DIR__ . '/../src/actions/mods.php';
require_once __DIR__ . '/../src/actions/state.php';
require_once __DIR__ . '/../src/actions/system.php';

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

test_case('Nur nicht getrackte Einheiten dürfen mehreren Einsätzen zugeordnet bleiben', static function (): void {
    expect_true(vehicle_supports_multiple_assignments(['game_vehicle_id' => 'FUSTW', 'type' => 'FUSTW']));
    expect_true(vehicle_supports_multiple_assignments(['game_vehicle_id' => 'extern', 'type' => 'TD']));
    expect_true(!vehicle_supports_multiple_assignments(['game_vehicle_id' => '1_HLF_1', 'type' => 'HLF']));
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

test_case('Bridge-Kennung wird geprüft und normalisiert', static function (): void {
    $bridge = normalize_bridge_descriptor([
        'kind' => 'aublst-bridge',
        'protocol_version' => 1,
        'app_version' => '0.2.0-beta+4',
        'capabilities' => ['custom-paths-v1', ' durable-queue-v1 ', 'custom-paths-v1'],
    ]);
    expect_same([
        'kind' => 'aublst-bridge',
        'protocol_version' => 1,
        'app_version' => '0.2.0-beta+4',
        'capabilities' => ['custom-paths-v1', 'durable-queue-v1'],
    ], $bridge);
    expect_same(null, normalize_bridge_descriptor(['kind' => 'legacy']));
});

test_case('Capabilities melden das Bridge-Protokoll des neuen Adapters', static function (): void {
    $capabilities = system_capabilities();
    expect_same([1], $capabilities['bridge_protocols']);
    expect_same(['commands-pending-ack-v1'], $capabilities['bridge_features']);
});

test_case('Monitor-Sitzungsdaten enthalten Kartengrenzen ohne interne Felder', static function (): void {
    $result = state_session_data([
        'token' => 'a1b2',
        'revision' => 0,
        'mod_id' => 'AUBMP',
        'monitor_show_hospital_capacity' => '1',
        'min_x' => '-100.5',
        'min_y' => '-200',
        'max_x' => '300',
        'max_y' => '400.5',
        'pin' => '1234',
    ]);
    expect_same([
        'token' => 'a1b2',
        'revision' => 0,
        'mod_id' => 'AUBMP',
        'routing_version' => routing_version_for_mod('AUBMP'),
        'map_image_version' => map_image_version_for_mod('AUBMP'),
        'monitor_show_hospital_capacity' => true,
        'bridge' => [
            'kind' => 'legacy',
            'protocol_version' => 0,
            'app_version' => null,
            'capabilities' => [],
            'seen_at' => null,
        ],
        'map_content_rect' => [
            'x' => 52.0,
            'y' => 100.0,
            'width' => 2048.0,
            'height' => 2048.0,
        ],
        'map_bounds' => [
            'min_x' => -100.5,
            'min_y' => -200.0,
            'max_x' => 300.0,
            'max_y' => 400.5,
        ],
    ], $result);
});

test_case('Sitzungsdaten geben die vom Adapter gemeldete Bridge zurück', static function (): void {
    $result = state_session_data([
        'token' => 'a1b2',
        'revision' => 4,
        'mod_id' => 'AUBMP',
        'min_x' => 0,
        'min_y' => 0,
        'max_x' => 1000,
        'max_y' => 1000,
        'bridge_kind' => 'aublst-bridge',
        'bridge_protocol_version' => 1,
        'bridge_app_version' => '0.2.0',
        'bridge_capabilities' => '["custom-paths-v1","durable-queue-v1"]',
        'bridge_seen_at' => '2026-09-03 12:34:56',
    ]);
    expect_same([
        'kind' => 'aublst-bridge',
        'protocol_version' => 1,
        'app_version' => '0.2.0',
        'capabilities' => ['custom-paths-v1', 'durable-queue-v1'],
        'seen_at' => '2026-09-03 12:34:56',
    ], $result['bridge']);
});

test_case('AUBMP verwendet das neue Kartenbild mit separater Spielarea', static function (): void {
    $map = local_map_definition('AUBMP');
    expect_true($map !== null);
    expect_same('AUBMP_2.webp', basename((string)$map['file']));
    expect_same(['x' => 52.0, 'y' => 100.0, 'width' => 2048.0, 'height' => 2048.0], $map['content_rect']);
});

test_case('Klinikkapazitäten verwenden Rot, Gelb und Grün mit den neuen Grenzen', static function (): void {
    expect_same('full', state_hospital_capacity_level(0));
    expect_same('low', state_hospital_capacity_level(1));
    expect_same('low', state_hospital_capacity_level(2));
    expect_same('ok', state_hospital_capacity_level(3));
});

test_case('Nur echte Fahrzeugstatuswechsel stoßen die Einsatzleiterprüfung an', static function (): void {
    $saved = ['status' => 3];
    expect_true(!vehicle_update_requires_leader_reconcile($saved, ['status' => 3]));
    expect_true(vehicle_update_requires_leader_reconcile($saved, ['status' => 4]));
    expect_true(vehicle_update_requires_leader_reconcile(['status' => 4, 'type' => 'HLF'], ['type' => 'ELW']));
    expect_true(!vehicle_update_requires_leader_reconcile(false, ['status' => 4]));
    expect_true(!vehicle_update_requires_leader_reconcile($saved, ['name' => '1-HLF-1']));
});

test_case('Nur echte Einsatzstatuswechsel stoßen die Einsatzleiterprüfung an', static function (): void {
    $saved = ['status' => 'active'];
    expect_true(!event_update_requires_leader_reconcile($saved, ['status' => 'active']));
    expect_true(event_update_requires_leader_reconcile($saved, ['status' => 'completed']));
    expect_true(!event_update_requires_leader_reconcile(false, ['status' => 'active']));
});

test_case('Sprechwunschvarianten werden als Status 5 erkannt', static function (): void {
    expect_true(message_is_speech_request(['message' => 'S5']));
    expect_true(message_is_speech_request(['message' => 'FMS5']));
    expect_true(message_is_speech_request(['message' => 'Info', 'long_message' => 'Fahrzeug mit Sprechwunsch']));
    expect_true(!message_is_speech_request(['message' => 'S4', 'long_message' => 'Ankunft']));
});

test_case('Einsatzleiter RD wird ab drei RTW nach der ersten Ankunft bestimmt', static function (): void {
    $vehicles = [
        ['id' => 1, 'game_vehicle_id' => '1_RTW_A', 'status' => 4, 'first_status_4_at' => '2026-08-18 10:02:00'],
        ['id' => 2, 'game_vehicle_id' => '2_RTW_A', 'status' => 4, 'first_status_4_at' => '2026-08-18 10:04:00'],
        ['id' => 3, 'game_vehicle_id' => '3_RTW_A', 'status' => 3, 'first_status_4_at' => null],
    ];
    expect_same(1, select_medical_incident_leader($vehicles));
    expect_same(null, select_medical_incident_leader(array_slice($vehicles, 0, 2)));
});

test_case('Das erste eingetroffene Notarztfahrzeug übernimmt den Einsatzleiter RD', static function (): void {
    $vehicles = [
        ['id' => 1, 'game_vehicle_id' => '1_RTW_A', 'status' => 4, 'first_status_4_at' => '2026-08-18 10:02:00'],
        ['id' => 2, 'game_vehicle_id' => '2_RTW_A', 'status' => 4, 'first_status_4_at' => '2026-08-18 10:04:00'],
        ['id' => 3, 'game_vehicle_id' => '3_RTW_A', 'status' => 3, 'first_status_4_at' => null],
        ['id' => 4, 'game_vehicle_id' => '4_NEF_A', 'status' => 4, 'first_status_4_at' => '2026-08-18 10:06:00'],
        ['id' => 5, 'game_vehicle_id' => '2_NEF_A', 'status' => 4, 'first_status_4_at' => '2026-08-18 10:08:00'],
    ];
    expect_same(4, select_medical_incident_leader($vehicles));
    $vehicles[3]['status'] = 7;
    expect_same(5, select_medical_incident_leader($vehicles));
    $vehicles[4]['status'] = 1;
    expect_same(1, select_medical_incident_leader($vehicles));
});

test_case('Zwei Notarztfahrzeuge reichen für einen Einsatzleiter RD', static function (): void {
    $vehicles = [
        ['id' => 1, 'game_vehicle_id' => '4_NEF_A', 'status' => 4, 'first_status_4_at' => '2026-08-18 10:04:00'],
        ['id' => 2, 'game_vehicle_id' => 'Christoph_82', 'status' => 4, 'first_status_4_at' => '2026-08-18 10:02:00'],
    ];
    expect_same(2, select_medical_incident_leader($vehicles));
    expect_same(null, select_medical_incident_leader(array_slice($vehicles, 0, 1)));
});

test_case('Notarzt- und Intensivtransportmittel gelten als notarztbesetzt', static function (): void {
    foreach (['NEF', 'NAW', 'ITW', 'RTH', 'ITH'] as $type) {
        expect_true(is_physician_staffed_incident_vehicle(['game_vehicle_id' => "4_{$type}_A"]));
    }
    expect_true(is_physician_staffed_incident_vehicle(['game_vehicle_id' => 'Christoph_82']));
    expect_true(is_rescue_incident_vehicle(['game_vehicle_id' => 'Christoph_82']));
    expect_true(!is_physician_staffed_incident_vehicle(['game_vehicle_id' => '4_RTW_A']));
});

test_case('Einsatzleiter FW folgt der Reihenfolge HLF, ELW, B-Dienst und A-Dienst', static function (): void {
    $vehicles = [
        ['id' => 1, 'game_vehicle_id' => '2_HLF_1', 'type' => 'HLF', 'status' => 4, 'first_status_4_at' => '2026-08-18 10:02:00'],
        ['id' => 2, 'game_vehicle_id' => '3_HLF_1', 'type' => 'HLF', 'status' => 4, 'first_status_4_at' => '2026-08-18 10:04:00'],
    ];
    expect_same(1, select_fire_incident_leader($vehicles));

    $vehicles[] = ['id' => 3, 'game_vehicle_id' => '2_ELW_1', 'type' => 'ELW', 'status' => 4, 'first_status_4_at' => '2026-08-18 10:06:00'];
    expect_same(3, select_fire_incident_leader($vehicles));

    $vehicles[] = ['id' => 4, 'game_vehicle_id' => '4_ELW_1', 'type' => 'ELW', 'status' => 4, 'first_status_4_at' => '2026-08-18 10:08:00'];
    expect_same(4, select_fire_incident_leader($vehicles));

    $vehicles[] = ['id' => 5, 'game_vehicle_id' => '1_KDOW_1', 'type' => 'KDOW', 'status' => 4, 'first_status_4_at' => '2026-08-18 10:10:00'];
    expect_same(5, select_fire_incident_leader($vehicles));

    $vehicles[4]['status'] = 7;
    expect_same(4, select_fire_incident_leader($vehicles));
    $vehicles[3]['status'] = 1;
    expect_same(3, select_fire_incident_leader($vehicles));
    $vehicles[2]['status'] = 1;
    expect_same(1, select_fire_incident_leader($vehicles));
});

test_case('Einsatzleiter FW wird erst nach Status 4 automatisch bestimmt', static function (): void {
    expect_same(null, select_fire_incident_leader([
        ['id' => 1, 'game_vehicle_id' => '2-HLF-1', 'type' => 'HLF', 'status' => 3, 'first_status_4_at' => null],
        ['id' => 2, 'game_vehicle_id' => '2-ELW-1', 'type' => 'ELW', 'status' => 3, 'first_status_4_at' => null],
        ['id' => 3, 'game_vehicle_id' => '4-ELW-1', 'type' => 'ELW', 'status' => 3, 'first_status_4_at' => null],
        ['id' => 4, 'game_vehicle_id' => '1-KDOW-1', 'type' => 'KDOW', 'status' => 3, 'first_status_4_at' => null],
    ]));
});

test_case('Einsatzleiterwechsel werden als Rückmeldung formuliert', static function (): void {
    expect_same(
        'Einsatzleiter FW bestimmt: 1-HLF-1',
        event_leader_feedback_text('fire', null, '1-HLF-1')
    );
    expect_same(
        'Einsatzleiter RD gewechselt: 1-RTW-1 → 4-NEF-A',
        event_leader_feedback_text('medical', '1-RTW-1', '4-NEF-A')
    );
    expect_same(
        'Einsatzleiter RD automatisch bestimmt: 1-RTW-1',
        event_leader_feedback_text('medical', null, '1-RTW-1', true)
    );
    expect_same(
        'Einsatzleiter FW aufgehoben: 1-HLF-1',
        event_leader_feedback_text('fire', '1-HLF-1', null)
    );
    expect_same(null, event_leader_feedback_text('fire', '1-HLF-1', '1-HLF-1'));
});

test_case('Straßennetz verwirft ungültige Kanten', static function (): void {
    $routing = normalize_routing_config([
        'meters_per_world_unit' => 0.1,
        'nodes' => [
            ['id' => 'a', 'x' => 10, 'y' => -20],
            ['id' => 'b', 'x' => 30, 'y' => -40],
        ],
        'edges' => [
            ['id' => 'valid', 'from' => 'a', 'to' => 'b', 'kind' => 'bridge', 'name' => ' Neustadtstraße '],
            ['id' => 'missing', 'from' => 'a', 'to' => 'c', 'kind' => 'road'],
        ],
    ]);
    expect_same(2, count($routing['nodes']));
    expect_same(1, count($routing['edges']));
    expect_same('bridge', $routing['edges'][0]['kind']);
    expect_same('Neustadtstraße', $routing['edges'][0]['name']);
});

test_case('Normalisierte Straßenpunkte werden auf Sitzungskoordinaten abgebildet', static function (): void {
    $routing = routing_for_session(normalize_routing_config([
        'coordinate_space' => 'normalized',
        'meters_per_world_unit' => 0.1,
        'map_width_px' => 8192,
        'map_height_px' => 8192,
        'pixels_per_meter' => 10.5,
        'grid_size_m' => 50,
        'nodes' => [['id' => 'mitte', 'x' => 0.5, 'y' => -0.25]],
        'edges' => [],
        'bma_zones' => [[
            'id' => 'schloss',
            'name' => 'Schloss',
            'points' => [
                ['x' => 0.4, 'y' => -0.2],
                ['x' => 0.6, 'y' => -0.2],
                ['x' => 0.5, 'y' => -0.4],
            ],
        ]],
    ]), [
        'min_x' => -100,
        'max_x' => 300,
        'min_y' => 0,
        'max_y' => 400,
    ]);
    expect_same('world', $routing['coordinate_space']);
    expect_same(100.0, $routing['nodes'][0]['x']);
    expect_same(-100.0, $routing['nodes'][0]['y']);
    expect_same(60.0, $routing['bma_zones'][0]['points'][0]['x']);
    expect_same(-80.0, $routing['bma_zones'][0]['points'][0]['y']);
    expect_same(140.0, $routing['bma_zones'][0]['points'][1]['x']);
    expect_same(-160.0, $routing['bma_zones'][0]['points'][2]['y']);
    $expected_scale = (8192 / 10.5) / 400;
    expect_true(abs($routing['meters_per_world_unit_x'] - $expected_scale) < 0.000001);
    expect_true(abs($routing['meters_per_world_unit_y'] - $expected_scale) < 0.000001);
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
