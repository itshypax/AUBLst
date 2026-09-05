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
require_once __DIR__ . '/src/actions/layouts.php';
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
    'metrics_summary'        => 'action_metrics_summary',
    'session_create'         => 'action_session_create',
    'session_validate'       => 'action_session_validate',
    'session_monitor_hospital_capacity_set' => 'action_session_monitor_hospital_capacity_set',
    'session_statistics'     => 'action_session_statistics',
    'events_archive'         => 'action_events_archive',
    'event_record'           => 'action_event_record',
    'sync'                   => 'action_sync',
    'mods_put'               => 'action_mods_put',
    'map_asset'              => 'action_map_asset',
    'map_image'              => 'action_map_image',
    'routing_get'            => 'action_routing_get',
    'routing_put'            => 'action_routing_put',
    'state'                  => 'action_state',
    'monitor_state'          => 'action_monitor_state',
    'positions'              => 'action_positions',
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
    'vehicles_set_unavailable' => 'action_vehicles_set_unavailable',
    'commands_pending'       => 'action_commands_pending',
    'commands_ack'           => 'action_commands_ack',
    'logs'                   => 'action_logs',
    'log_acknowledge'        => 'action_log_acknowledge',
    'log_viewed'             => 'action_log_viewed',
    'layouts_get'            => 'action_layouts_get',
    'layouts_put'            => 'action_layouts_put',
    'layouts_delete'         => 'action_layouts_delete',
];

const DISPATCHER_WRITE_ACTIONS = [
    'session_monitor_hospital_capacity_set',
    'events_create',
    'events_finish',
    'events_assign',
    'events_reassign',
    'events_set_leader',
    'events_unassign',
    'events_set_note',
    'events_add_feedback',
    'vehicles_assign_player',
    'vehicles_alarm',
    'vehicles_set_unavailable',
    'hospital_reservation_set',
    'hospital_reservation_clear',
    'log_viewed',
    'log_acknowledge',
    'routing_put',
    'layouts_put',
    'layouts_delete',
];

$action = $_GET['action'] ?? $_POST['action'] ?? null;

try {
    if ($action === null || !isset(ACTIONS[$action])) {
        respond_json(400, ['error' => 'Unknown or missing action']);
    }
    if ($action === 'map_asset') {
        action_map_asset();
    }
    $pdo = pdo_conn();
    if (in_array($action, DISPATCHER_WRITE_ACTIONS, true)) {
        $request = get_json_input();
        require_session($pdo, $request['session_token'] ?? null, $request['pin'] ?? null, true);
    }
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
