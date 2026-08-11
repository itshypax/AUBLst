-- Wird beim ersten Request automatisch eingespielt (siehe src/database.php).

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS mods (
  mod_id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255),
  map_image LONGBLOB,
  mime_type VARCHAR(128) DEFAULT 'image/png',
  meters_per_world_unit DOUBLE NOT NULL DEFAULT 0.1,
  routing_graph LONGTEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(10) NOT NULL UNIQUE,
  pin VARCHAR(10) NULL,
  mod_id VARCHAR(255) NULL,
  min_x DOUBLE DEFAULT 0,
  min_y DOUBLE DEFAULT 0,
  max_x DOUBLE DEFAULT 1000,
  max_y DOUBLE DEFAULT 1000,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_mod FOREIGN KEY (mod_id) REFERENCES mods(mod_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS players (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  player_uid VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_player (session_id, player_uid),
  CONSTRAINT fk_players_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vehicles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  game_vehicle_id VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  type VARCHAR(255),
  modes VARCHAR(255),
  x DOUBLE,
  y DOUBLE,
  status INT,
  assigned_player_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_vehicle (session_id, game_vehicle_id),
  INDEX idx_session (session_id),
  CONSTRAINT fk_vehicles_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_vehicles_player FOREIGN KEY (assigned_player_id) REFERENCES players(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS hospitals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  game_hospital_id VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  x DOUBLE,
  y DOUBLE,
  icu_total INT DEFAULT 0,
  icu_available INT DEFAULT 0,
  ward_total INT DEFAULT 0,
  ward_available INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_hospital (session_id, game_hospital_id),
  CONSTRAINT fk_hospitals_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS hospital_reservations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  vehicle_id INT NOT NULL,
  hospital_id INT NOT NULL,
  bed_type ENUM('ward','icu') NOT NULL,
  status ENUM('reserved','arrived') NOT NULL DEFAULT 'reserved',
  baseline_available INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  arrived_at TIMESTAMP NULL,
  UNIQUE KEY uniq_hospital_reservation_vehicle (session_id, vehicle_id),
  INDEX idx_hospital_reservation_capacity (session_id, hospital_id, bed_type, status),
  CONSTRAINT fk_hospital_reservation_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_hospital_reservation_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
  CONSTRAINT fk_hospital_reservation_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  game_event_id VARCHAR(255) NULL,
  name VARCHAR(255),
  x DOUBLE,
  y DOUBLE,
  status ENUM('active','completed','canceled') DEFAULT 'active',
  created_by ENUM('game','frontend') DEFAULT 'game',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_event_game (session_id, game_event_id),
  INDEX idx_session_status (session_id, status),
  CONSTRAINT fk_events_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE events AUTO_INCREMENT = 1000;

CREATE TABLE IF NOT EXISTS assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  event_id INT NOT NULL,
  vehicle_id INT NOT NULL,
  assigned_player_id INT NULL,
  status ENUM('enroute','on_scene','completed','canceled') DEFAULT 'enroute',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_assignment (event_id, vehicle_id),
  INDEX idx_session_event (session_id, event_id),
  CONSTRAINT fk_asg_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_asg_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_asg_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
  CONSTRAINT fk_asg_player FOREIGN KEY (assigned_player_id) REFERENCES players(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  event_id INT NOT NULL,
  content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_session_note (session_id, event_id),
  UNIQUE KEY uniq_note_game (session_id, event_id),
  CONSTRAINT nt_asg_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT nt_asg_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS commands (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  type ENUM('move','alarm','assign','unassign','event_delete','event_create') NOT NULL,
  payload JSON NOT NULL,
  processed TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  INDEX idx_session_processed (session_id, processed, id),
  CONSTRAINT fk_commands_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alarm_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  command_id INT NULL,
  event_id INT NULL,
  event_name VARCHAR(255) NULL,
  vehicle_id INT NULL,
  game_vehicle_id VARCHAR(255) NOT NULL,
  vehicle_name VARCHAR(255) NULL,
  assigned_player_id INT NULL,
  player_name VARCHAR(255) NULL,
  mode VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_alarm_history_command (command_id),
  INDEX idx_alarm_history_session (session_id, created_at, id),
  INDEX idx_alarm_history_event (session_id, event_id, created_at),
  INDEX idx_alarm_history_vehicle (session_id, vehicle_id, created_at),
  CONSTRAINT fk_alarm_history_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS activity_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  type ENUM('global','event','vehicle') NOT NULL,
  entity_id VARCHAR(255) NULL,
  event_id INT NULL,
  message VARCHAR(20) NOT NULL,
  long_message VARCHAR(512) NOT NULL,
  state ENUM('active','inactive','disabled') NOT NULL,
  meta JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_session (session_id, id),
  INDEX idx_session_updated (session_id, updated_at, id),
  UNIQUE KEY uniq_activity_log (session_id, entity_id, message),
  CONSTRAINT fk_logs_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS clock (
  session_id INT NOT NULL PRIMARY KEY,
  time_hours TINYINT(1) DEFAULT 0,
  time_minutes TINYINT(1) DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  client_key CHAR(64) PRIMARY KEY,
  failures SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  window_started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  blocked_until TIMESTAMP NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_auth_rate_limit_cleanup (updated_at)
) ENGINE=InnoDB;
