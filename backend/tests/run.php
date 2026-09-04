<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/database.php';
require_once __DIR__ . '/../src/domain.php';
require_once __DIR__ . '/../src/http.php';
require_once __DIR__ . '/../src/migrations.php';
require_once __DIR__ . '/../src/repository.php';
require_once __DIR__ . '/../src/actions/mods.php';
require_once __DIR__ . '/../src/actions/state.php';

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
        'position_revision' => 0,
        'mod_id' => 'AUBMP',
        'routing_version' => routing_version_for_mod('AUBMP'),
        'map_image_version' => map_image_version_for_mod('AUBMP'),
        'monitor_show_hospital_capacity' => true,
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

test_case('Datenbankverbindung bekommt den Offset der App-Zeitzone', static function (): void {
    $berlin = new DateTimeZone('Europe/Berlin');
    expect_same('+02:00', db_session_time_zone($berlin, new DateTimeImmutable('2026-09-04 18:50:00', $berlin)));
    expect_same('+01:00', db_session_time_zone($berlin, new DateTimeImmutable('2026-01-15 18:50:00', $berlin)));
    expect_same('+00:00', db_session_time_zone(new DateTimeZone('UTC'), new DateTimeImmutable('2026-09-04 18:50:00')));
    $newYork = new DateTimeZone('America/New_York');
    expect_same('-04:00', db_session_time_zone($newYork, new DateTimeImmutable('2026-09-04 12:00:00', $newYork)));
    $kolkata = new DateTimeZone('Asia/Kolkata');
    expect_same('+05:30', db_session_time_zone($kolkata, new DateTimeImmutable('2026-09-04 12:00:00', $kolkata)));
});

test_case('Ohne APP_TIMEZONE gilt Europe/Berlin', static function (): void {
    expect_same('Europe/Berlin', app_time_zone()->getName());
});

test_case('Fahrzeugupdate: neues Fahrzeug zählt als Daten- und Positionsänderung', static function (): void {
    $kinds = vehicle_change_kinds(false, ['name' => '1-HLF-1', 'type' => 'HLF', 'modes' => null, 'x' => 1, 'y' => 2, 'status' => 2]);
    expect_same(['positions' => true, 'data' => true], $kinds);
});

test_case('Fahrzeugupdate: nur Koordinaten anders ist eine reine Positionsänderung', static function (): void {
    $saved = ['name' => '1-HLF-1', 'type' => 'HLF', 'modes' => 'Normal,Sonder', 'x' => 1.0, 'y' => 2.0, 'status' => 3];
    $kinds = vehicle_change_kinds($saved, ['name' => '1-HLF-1', 'type' => 'HLF', 'modes' => 'Normal,Sonder', 'x' => 1.5, 'y' => 2.0, 'status' => 3]);
    expect_same(['positions' => true, 'data' => false], $kinds);
});

test_case('Fahrzeugupdate: Statuswechsel ist eine Datenänderung ohne Positionsänderung', static function (): void {
    $saved = ['name' => '1-HLF-1', 'type' => 'HLF', 'modes' => null, 'x' => 1.0, 'y' => 2.0, 'status' => 3];
    $kinds = vehicle_change_kinds($saved, ['name' => '1-HLF-1', 'type' => 'HLF', 'modes' => null, 'x' => 1.0, 'y' => 2.0, 'status' => 4]);
    expect_same(['positions' => false, 'data' => true], $kinds);
});

test_case('Fahrzeugupdate: identische Werte ändern nichts', static function (): void {
    $saved = ['name' => '1-HLF-1', 'type' => 'HLF', 'modes' => null, 'x' => 1.0, 'y' => 2.0, 'status' => 3];
    $kinds = vehicle_change_kinds($saved, ['name' => '1-HLF-1', 'type' => 'HLF', 'modes' => null, 'x' => '1', 'y' => '2', 'status' => '3']);
    expect_same(['positions' => false, 'data' => false], $kinds);
});

test_case('Sync-Fingerabdruck ignoriert Positionen und Fahrzeugreihenfolge, nicht aber Status, Einsätze und Uhrzeit', static function (): void {
    $base = [
        'vehicles' => [
            ['game_vehicle_id' => '1_HLF_1', 'status' => 2, 'x' => 10, 'y' => 20],
            ['game_vehicle_id' => '2_RTW_1', 'status' => 1, 'x' => 30, 'y' => 40],
        ],
        'events' => [['game_event_id' => '7', 'name' => 'Brand', 'x' => 1, 'y' => 2]],
        'time' => ['h' => 18, 'm' => 50],
    ];
    $moved = $base;
    $moved['vehicles'][0]['x'] = 99;
    $reordered = $base;
    $reordered['vehicles'] = array_reverse($base['vehicles']);
    $status = $base;
    $status['vehicles'][0]['status'] = 3;
    $event = $base;
    $event['events'][0]['name'] = 'Brand 2';
    $clock = $base;
    $clock['time']['m'] = 51;

    $fingerprint = sync_fingerprint($base);
    expect_same(64, strlen($fingerprint));
    expect_same($fingerprint, sync_fingerprint($moved));
    expect_same($fingerprint, sync_fingerprint($reordered));
    expect_true($fingerprint !== sync_fingerprint($status), 'Statuswechsel muss den Fingerabdruck ändern');
    expect_true($fingerprint !== sync_fingerprint($event), 'Einsatzänderung muss den Fingerabdruck ändern');
    expect_true($fingerprint !== sync_fingerprint($clock), 'Uhrzeit muss den Fingerabdruck ändern');
});

test_case('Revisionscache: Schlüssel je Sitzung', static function (): void {
    expect_same('aublst:rev:42', revision_cache_key(42));
    expect_same('aublst:rev:42', revision_cache_key('42'));
});

test_case('Revisionscache: liefert gespeicherte Revisionen oder null', static function (): void {
    if (!revision_cache_available()) {
        // Ohne APCu bleibt der Datenbankpfad im Stream aktiv.
        revision_cache_store(7, 3, 9);
        expect_same(null, revision_cache_fetch(7));
        return;
    }
    if (!apcu_enabled()) {
        throw new RuntimeException('APCu ist geladen, aber apc.enable_cli fehlt; der Test kann den Cache nicht prüfen.');
    }
    expect_same(null, revision_cache_fetch(999999));
    revision_cache_store(7, 3, 9);
    expect_same([3, 9], revision_cache_fetch(7));
    revision_cache_store(7, 4, 9);
    expect_same([4, 9], revision_cache_fetch(7));
    // Der Stream darf einen vorhandenen Wert nicht überschreiben.
    revision_cache_store(7, 2, 1, true);
    expect_same([4, 9], revision_cache_fetch(7));
    revision_cache_store(8, 2, 1, true);
    expect_same([2, 1], revision_cache_fetch(8));
});

test_case('Wirkstatus: ohne Override gilt der Spielstatus', static function (): void {
    expect_same(['status' => 3, 'game_status' => 3, 'override' => false], vehicle_effective_status(['status' => 2, 'game_status' => 2, 'unavailable_override' => 0], 3));
    expect_same(['status' => 2, 'game_status' => 2, 'override' => false], vehicle_effective_status(false, 2));
    expect_same(['status' => 2, 'game_status' => 2, 'override' => false], vehicle_effective_status(false, null));
});

test_case('Wirkstatus: Override hält Status 6, bis das Spiel Status 2 meldet', static function (): void {
    $saved = ['status' => 6, 'game_status' => 4, 'unavailable_override' => 1];
    expect_same(['status' => 6, 'game_status' => 3, 'override' => true], vehicle_effective_status($saved, 3));
    expect_same(['status' => 6, 'game_status' => 4, 'override' => true], vehicle_effective_status($saved, null));
    expect_same(['status' => 2, 'game_status' => 2, 'override' => false], vehicle_effective_status($saved, 2));
});

test_case('Wirkstatus: Spielstatus 6 bleibt ohne Override ein Spielstatus', static function (): void {
    expect_same(['status' => 6, 'game_status' => 6, 'override' => false], vehicle_effective_status(['status' => 4, 'game_status' => 4, 'unavailable_override' => 0], 6));
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
