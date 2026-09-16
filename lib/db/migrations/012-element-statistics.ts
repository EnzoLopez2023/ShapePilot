import type { Migration } from '../migrate.ts'

/**
 * Household monitoring is independent of app membership and designer data.
 * No seed row or credential belongs here. Connection identities and job/event
 * history are retained; only the minute-sampled telemetry has a deletion path.
 * Live job ids can precede history pages, so telemetry/events reference their
 * connection but do not require an already-imported job.
 */
export const migration012: Migration = {
  id: '012-element-statistics',
  name: 'EL-ement statistics',
  statements: [
    `CREATE TABLE element_statistics_connections (
  id            TEXT NOT NULL PRIMARY KEY CHECK (length(trim(id)) > 0),
  account_id    TEXT NOT NULL CHECK (length(trim(account_id)) > 0),
  account_name  TEXT,
  region        TEXT NOT NULL CHECK (region IN ('global', 'china')),
  printer_id    TEXT NOT NULL CHECK (length(trim(printer_id)) > 0),
  printer_name  TEXT NOT NULL,
  printer_model TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (account_id, region, printer_id)
)`,
    `CREATE INDEX element_statistics_connections_created
  ON element_statistics_connections (created_at, id)`,
    `CREATE TABLE element_statistics_settings (
  singleton            INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  enabled              INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  active_connection_id TEXT REFERENCES element_statistics_connections(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  updated_at           TEXT
)`,
    `CREATE TABLE element_statistics_sync_state (
  connection_id          TEXT NOT NULL PRIMARY KEY
    REFERENCES element_statistics_connections(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  backfill_cursor        TEXT,
  backfill_complete      INTEGER NOT NULL CHECK (backfill_complete IN (0, 1)),
  backfill_started_at    TEXT,
  backfill_completed_at  TEXT,
  backfill_pages         INTEGER NOT NULL CHECK (backfill_pages >= 0),
  backfill_seen_cursors  TEXT NOT NULL
    CHECK (json_valid(backfill_seen_cursors) AND json_type(backfill_seen_cursors) = 'array'),
  refresh_cursor         TEXT,
  refresh_boundary       TEXT,
  refresh_seen_cursors   TEXT NOT NULL
    CHECK (json_valid(refresh_seen_cursors) AND json_type(refresh_seen_cursors) = 'array'),
  last_attempt_at        TEXT,
  last_success_at        TEXT,
  last_full_scan_at      TEXT,
  next_sync_at           TEXT,
  consecutive_failures   INTEGER NOT NULL CHECK (consecutive_failures >= 0),
  remote_total           INTEGER CHECK (remote_total >= 0),
  problem_code           TEXT,
  problem_message        TEXT,
  CHECK ((problem_code IS NULL) = (problem_message IS NULL))
)`,
    `CREATE TABLE element_statistics_jobs (
  connection_id              TEXT NOT NULL
    REFERENCES element_statistics_connections(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  cloud_job_id               TEXT NOT NULL CHECK (length(trim(cloud_job_id)) > 0),
  title                      TEXT,
  result                     TEXT NOT NULL
    CHECK (result IN ('completed', 'failed_or_aborted', 'active', 'unknown')),
  raw_status                 TEXT,
  started_at                 TEXT,
  ended_at                   TEXT,
  actual_duration_seconds    REAL CHECK (actual_duration_seconds >= 0),
  estimated_duration_seconds REAL CHECK (estimated_duration_seconds >= 0),
  estimated_weight_grams     REAL CHECK (estimated_weight_grams >= 0),
  estimated_length           REAL CHECK (estimated_length >= 0),
  length_unit                TEXT CHECK (length_unit IN ('mm', 'm')),
  materials_json             TEXT NOT NULL
    CHECK (json_valid(materials_json) AND json_type(materials_json) = 'array'),
  warnings_json              TEXT NOT NULL
    CHECK (json_valid(warnings_json) AND json_type(warnings_json) = 'array'),
  first_seen_at              TEXT NOT NULL,
  last_seen_at               TEXT NOT NULL,
  PRIMARY KEY (connection_id, cloud_job_id),
  CHECK (result <> 'active' OR (ended_at IS NULL AND actual_duration_seconds IS NULL))
)`,
    `CREATE INDEX element_statistics_jobs_connection_started
  ON element_statistics_jobs (connection_id, started_at DESC, cloud_job_id)`,
    `CREATE INDEX element_statistics_jobs_started
  ON element_statistics_jobs (started_at DESC, connection_id, cloud_job_id)`,
    `CREATE TABLE element_statistics_telemetry (
  connection_id    TEXT NOT NULL
    REFERENCES element_statistics_connections(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  sampled_minute   TEXT NOT NULL,
  received_at      TEXT NOT NULL,
  state            TEXT,
  job_id           TEXT,
  job_name         TEXT,
  progress_percent REAL CHECK (progress_percent BETWEEN 0 AND 100),
  remaining_minutes REAL CHECK (remaining_minutes >= 0),
  current_layer    INTEGER CHECK (current_layer >= 0),
  total_layers     INTEGER CHECK (total_layers >= 0),
  nozzle_actual_c  REAL,
  nozzle_target_c  REAL,
  bed_actual_c     REAL,
  bed_target_c     REAL,
  wifi_signal_dbm  REAL,
  print_error      TEXT,
  hms_json         TEXT
    CHECK (hms_json IS NULL OR (json_valid(hms_json) AND json_type(hms_json) = 'array')),
  ams_json         TEXT
    CHECK (ams_json IS NULL OR (json_valid(ams_json) AND json_type(ams_json) = 'array')),
  field_updated_at TEXT NOT NULL
    CHECK (json_valid(field_updated_at) AND json_type(field_updated_at) = 'object'),
  PRIMARY KEY (connection_id, sampled_minute)
)`,
    `CREATE INDEX element_statistics_telemetry_received
  ON element_statistics_telemetry (received_at)`,
    `CREATE TABLE element_statistics_events (
  id            INTEGER PRIMARY KEY,
  connection_id TEXT NOT NULL
    REFERENCES element_statistics_connections(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  occurred_at   TEXT NOT NULL,
  kind          TEXT NOT NULL
    CHECK (kind IN ('printer_state', 'printer_error', 'connection', 'sync_error',
      'sync_recovered', 'recording_gap')),
  code          TEXT NOT NULL,
  message       TEXT NOT NULL,
  job_id        TEXT,
  replay_key    TEXT NOT NULL UNIQUE
)`,
    `CREATE INDEX element_statistics_events_connection_time
  ON element_statistics_events (connection_id, occurred_at DESC, id DESC)`,
    `CREATE INDEX element_statistics_events_time
  ON element_statistics_events (occurred_at DESC, id DESC)`,
    `CREATE INDEX element_statistics_events_job_time
  ON element_statistics_events (connection_id, job_id, occurred_at DESC, id DESC)`,
  ],
}
