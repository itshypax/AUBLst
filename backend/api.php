<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/src/http.php';
require_once __DIR__ . '/src/database.php';
require_once __DIR__ . '/src/domain.php';
require_once __DIR__ . '/src/session.php';
require_once __DIR__ . '/src/repository.php';
require_once __DIR__ . '/src/actions/sessions.php';
require_once __DIR__ . '/src/actions/mods.php';
require_once __DIR__ . '/src/actions/state.php';
require_once __DIR__ . '/src/actions/vehicles.php';
require_once __DIR__ . '/src/actions/hospitals.php';
require_once __DIR__ . '/src/actions/events.php';
require_once __DIR__ . '/src/actions/commands.php';
require_once __DIR__ . '/src/actions/logs.php';
require_once __DIR__ . '/src/actions/system.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    if (!current_cors_request_allowed()) {
        respond_json(403, ['error' => 'Origin not allowed']);
    }
    send_cors_headers();
    exit;
}

const ACTIONS = [
    'capabilities'           => 'action_capabilities',
    'stream'                 => 'action_stream',
    'metrics_record'         => 'action_metrics_record',
    'session_create'         => 'action_session_create',
    'session_validate'       => 'action_session_validate',
    'session_statistics'     => 'action_session_statistics',
    'events_archive'         => 'action_events_archive',
    'event_record'           => 'action_event_record',
    'sync'                   => 'action_sync',
    'mods_put'               => 'action_mods_put',
    'map_image'              => 'action_map_image',
    'routing_get'            => 'action_routing_get',
    'routing_put'            => 'action_routing_put',
    'state'                  => 'action_state',
    'monitor_state'          => 'action_monitor_state',
    'status_history'         => 'action_status_history',
    'update_vehicles'        => 'action_update_vehicles',
    'update_hospitals'       => 'action_update_hospitals',
    'hospital_reservation_set' => 'action_hospital_reservation_set',
    'hospital_reservation_clear' => 'action_hospital_reservation_clear',
    'update_events'          => 'action_update_events',
    'events_create'          => 'action_events_create',
    'events_finish'          => 'action_events_finish',
    'events_assign'          => 'action_events_assign',
    'events_reassign'        => 'action_events_reassign',
    'events_get_vehicles'    => 'action_events_get_vehicles',
    'events_set_leader'      => 'action_events_set_leader',
    'events_get_logs'        => 'action_events_get_logs',
    'events_unassign'        => 'action_events_unassign',
    'events_get_note'        => 'action_events_get_note',
    'events_set_note'        => 'action_events_set_note',
    'vehicles_assign_player' => 'action_vehicles_assign_player',
    'events_get_feedback'    => 'action_events_get_feedback',
    'events_add_feedback'    => 'action_events_add_feedback',
    'vehicles_alarm'         => 'action_vehicles_alarm',
    'commands_pending'       => 'action_commands_pending',
    'commands_ack'           => 'action_commands_ack',
    'logs'                   => 'action_logs',
    'log_acknowledge'        => 'action_log_acknowledge',
    'log_viewed'             => 'action_log_viewed',
];

$action = $_GET['action'] ?? $_POST['action'] ?? null;

try {
    if ($action === null || !isset(ACTIONS[$action])) {
        respond_json(400, ['error' => 'Unknown or missing action']);
    }
    $pdo = pdo_conn();
    $handler = ACTIONS[$action];
    $handler($pdo);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        try {
            $pdo->rollBack();
        } catch (Throwable $rollbackError) {
            error_log('[aublst] rollback failed: ' . $rollbackError->getMessage());
        }
    }
    // Details nur ins Server-Log - PDO-Fehlertexte enthalten Query-Fragmente
    error_log(sprintf(
        '[aublst] action=%s %s: %s in %s:%d',
        $action ?? '-',
        get_class($e),
        $e->getMessage(),
        $e->getFile(),
        $e->getLine()
    ));
    respond_json(500, ['error' => 'Internal server error']);
}
