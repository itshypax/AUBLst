export interface MapBounds {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

export interface MapContentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Player {
  id: number;
  player_id: string;
  name: string | null;
}

export interface Vehicle {
  id: number;
  game_vehicle_id: string;
  name: string | null;
  type: string | null;
  modes: string | null;
  x: number;
  y: number;
  status: number;
  status_since?: string | null;
  assigned_player_id: number | null;
}

export interface EventItem {
  id: number;
  game_event_id: string | null;
  name: string | null;
  x: number;
  y: number;
  status: 'active' | 'completed' | 'canceled';
  created_by: 'game' | 'frontend';
  created_at?: string;
  updated_at?: string;
}

export interface Hospital {
  id: number;
  name: string | null;
  x: number;
  y: number;
  icu_total: number;
  icu_available: number;
  ward_total: number;
  ward_available: number;
}

export interface HospitalReservation {
  id: number;
  vehicle_id: number;
  hospital_id: number;
  bed_type: 'ward' | 'icu';
  status: 'reserved' | 'arrived';
  created_at: string;
  updated_at: string;
  arrived_at: string | null;
  game_vehicle_id: string;
  vehicle_name: string | null;
  hospital_name: string | null;
}

export interface MonitorHospitalCapacity {
  id: number;
  name: string | null;
  ward_level: 'ok' | 'low' | 'full';
  icu_level: 'ok' | 'low' | 'full';
}

export interface EventArchiveItem extends EventItem {
  dispatch_count: number;
  log_count: number;
  has_note: number | boolean;
}

export interface AlarmHistoryRow {
  id: number;
  event_id: number | null;
  event_name: string | null;
  vehicle_id: number | null;
  game_vehicle_id: string;
  vehicle_name: string | null;
  assigned_player_id: number | null;
  player_name: string | null;
  mode: string | null;
  created_at: string;
}

export interface EventRecordResponse {
  event: EventItem;
  alarms: AlarmHistoryRow[];
  logs: Array<Pick<LogRow, 'id' | 'type' | 'entity_id' | 'message' | 'long_message' | 'state' | 'updated_at'> & { created_at: string }>;
  note: (Pick<EventNote, 'id' | 'content'> & { created_at: string; updated_at: string }) | null;
  feedback: EventFeedback[];
}

export interface ClockTime {
  time_hours: number;
  time_minutes: number;
}

export interface LogRow {
  id: number;
  type: 'global' | 'event' | 'vehicle';
  entity_id: string | null;
  event_id: number | null;
  message: string;
  occurrence_id?: number | null;
  long_message: string;
  state: 'active' | 'inactive' | 'disabled';
  acknowledged?: boolean | number;
  created_at?: string;
  updated_at: string;
}

export interface AssignedVehicle {
  id: number;
  name: string | null;
  game_vehicle_id: string;
  status: number;
  alarm_modes?: string[];
  leader_role?: IncidentLeaderRole | null;
  leader_source?: IncidentLeaderSource | null;
}

export interface VehicleStatusChange {
  id: number;
  game_vehicle_id: string;
  vehicle_name: string | null;
  status: number;
  created_at: string;
}

export interface EventNote {
  id: number;
  event_id: number;
  content: string;
}

export interface Assignment {
  event_id: number;
  vehicle_id: number;
  alarm_modes?: string[];
  leader_role?: IncidentLeaderRole | null;
  leader_source?: IncidentLeaderSource | null;
}

export type IncidentLeaderRole = 'fire' | 'medical';
export type IncidentLeaderSource = 'automatic' | 'manual';

export interface EventFeedback {
  id: number;
  event_id: number;
  content: string;
  created_at: string;
}

export interface StatisticsEvent {
  id: number;
  name: string | null;
  x?: number;
  y?: number;
  status: 'active' | 'completed' | 'canceled';
  created_by: 'game' | 'frontend';
  created_at: string;
  updated_at: string;
}

export interface StatisticsDispatch {
  event_id: number | null;
  game_vehicle_id: string;
  vehicle_name: string;
  mode: string | null;
  created_at: string;
}

export interface StatisticsVehicleStatus {
  game_vehicle_id: string;
  vehicle_name: string | null;
  status: number;
  created_at: string;
}

export interface SessionStatisticsResponse {
  session: {
    token: string;
    mod_id?: string | null;
    map_bounds?: MapBounds;
    created_at: string;
    generated_at: string;
  };
  events: StatisticsEvent[];
  dispatches: StatisticsDispatch[];
  status_history: StatisticsVehicleStatus[];
  log_count: number;
}

export interface StateResponse {
  session: {
    token: string;
    mod_id: string | null;
    routing_version?: string | null;
    map_bounds: MapBounds;
    map_content_rect?: MapContentRect | null;
    monitor_show_hospital_capacity?: boolean;
  };
  players: Player[];
  vehicles: Vehicle[];
  hospitals: Hospital[];
  events: EventItem[];
  assignments?: Assignment[];
  hospital_reservations?: HospitalReservation[];
  monitor_hospital_capacities?: MonitorHospitalCapacity[];
  status_history?: VehicleStatusChange[];
  time: ClockTime | null;
}

export interface StatusHistoryResponse {
  status_history: VehicleStatusChange[];
}
