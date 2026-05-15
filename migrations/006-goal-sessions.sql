-- Migration 006: goal_sessions table
-- DB: /mnt/databases/atc-goal-sessions/goal_sessions.db
-- Applied via: ssh oracle 'mkdir -p /mnt/databases/atc-goal-sessions && sqlite3 /mnt/databases/atc-goal-sessions/goal_sessions.db < /path/006-goal-sessions.sql'

CREATE TABLE IF NOT EXISTS goal_sessions (
  id              TEXT PRIMARY KEY,
  goal_text       TEXT NOT NULL,
  status          TEXT NOT NULL,    -- 'pending' | 'running' | 'paused' | 'killed' | 'completed'
  cost_ceiling    REAL,             -- USD per-goal kill ceiling, NULL if not declared
  time_ceiling_hr REAL,             -- hours wall-clock, NULL if not declared
  henry_bound     TEXT,             -- JSON array of out-of-scope items
  no_progress     TEXT,             -- detector name e.g. '5-identical-error'
  killed_sentinel TEXT,             -- service-killed pattern
  created_at      TEXT NOT NULL,
  started_at      TEXT,
  paused_at       TEXT,
  killed_at       TEXT,
  completed_at    TEXT,
  cost_view_usd   REAL DEFAULT 0,
  cost_real_usd   REAL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_gs_status ON goal_sessions(status);
CREATE INDEX IF NOT EXISTS idx_gs_created ON goal_sessions(created_at);
