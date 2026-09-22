-- xWeek database schema (SQLite)
--
-- Design notes:
--   * Months, weeks and days are NOT tables. They are derived from a task's date,
--     so there is nothing to keep in sync and no "create the week first" step.
--   * Dates are stored as 'YYYY-MM-DD' and times as 'HH:MM' in the user's LOCAL time.
--     "Gym at 19:00" stays 19:00 across daylight-saving changes.
--   * Foreign keys are off by default in SQLite. Run this on every connection.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- settings: a single row of user preferences.
-- day_start / day_end define "waking hours", which the AI needs to answer
-- "how much free time do I have?" and "can I afford a part-time job?".
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    timezone      TEXT    NOT NULL DEFAULT 'UTC',   -- IANA name, e.g. 'Europe/Berlin'
    week_starts_on INTEGER NOT NULL DEFAULT 1 CHECK (week_starts_on IN (0, 1)), -- 0 = Sunday, 1 = Monday
    day_start     TEXT    NOT NULL DEFAULT '07:00' CHECK (day_start GLOB '[0-2][0-9]:[0-5][0-9]'),
    day_end       TEXT    NOT NULL DEFAULT '23:00' CHECK (day_end   GLOB '[0-2][0-9]:[0-5][0-9]'),
    CHECK (day_end > day_start)
);
INSERT INTO settings (id) VALUES (1);

-- ---------------------------------------------------------------------------
-- task_groups: the user's original intent behind one or more tasks.
--   "I need to study 20h in 5 days"  -> group (total_minutes = 1200) + 5 tasks
--   "I go to gym everyday 19-21"     -> group (recurrence_rule = 'FREQ=DAILY') + tasks
-- Lets the AI (and the GUI) edit or delete the whole plan in one go.
-- ---------------------------------------------------------------------------
CREATE TABLE task_groups (
    id                INTEGER PRIMARY KEY,
    title             TEXT    NOT NULL,
    description       TEXT,
    total_minutes     INTEGER CHECK (total_minutes > 0),  -- for split goals; NULL otherwise
    recurrence_rule   TEXT,                               -- iCalendar RRULE, e.g. 'FREQ=WEEKLY;BYDAY=MO,WE,FR'
    materialized_until TEXT,                              -- recurring tasks exist up to this date (inclusive)
    created_by        TEXT    NOT NULL DEFAULT 'user' CHECK (created_by IN ('user', 'ai')),
    created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- tasks: one concrete block on one day. This is what the calendar renders.
-- Recurring tasks are stored as real rows (created ahead of time up to
-- materialized_until), so every task can be edited or removed individually.
-- ---------------------------------------------------------------------------
CREATE TABLE tasks (
    id          INTEGER PRIMARY KEY,
    group_id    INTEGER REFERENCES task_groups(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    notes       TEXT,
    task_date   TEXT NOT NULL CHECK (task_date  GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
    start_time  TEXT NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
    end_time    TEXT NOT NULL CHECK (end_time   GLOB '[0-2][0-9]:[0-5][0-9]'),
    status      TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'cancelled')),
    created_by  TEXT NOT NULL DEFAULT 'user' CHECK (created_by IN ('user', 'ai')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (end_time > start_time)   -- tasks do not cross midnight; split them if needed
);

CREATE INDEX idx_tasks_date_time ON tasks (task_date, start_time);
CREATE INDEX idx_tasks_group     ON tasks (group_id);

-- ---------------------------------------------------------------------------
-- chat_messages: conversation history, used as context for the AI and shown in the GUI.
-- ---------------------------------------------------------------------------
CREATE TABLE chat_messages (
    id          INTEGER PRIMARY KEY,
    role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- task_changes: audit log of every create/update/delete the AI makes.
-- Enables "undo" and "what did you just change?". task_id has no foreign key
-- on purpose: the task may have been deleted, and the log must survive that.
-- ---------------------------------------------------------------------------
CREATE TABLE task_changes (
    id          INTEGER PRIMARY KEY,
    message_id  INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
    task_id     INTEGER NOT NULL,
    action      TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
    before_json TEXT,   -- NULL for 'create'
    after_json  TEXT,   -- NULL for 'delete'
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_task_changes_message ON task_changes (message_id);

-- ===========================================================================
-- Example queries
-- ===========================================================================

-- Week view (bind :week_start and :week_end as 'YYYY-MM-DD'):
--   SELECT * FROM tasks
--   WHERE task_date BETWEEN :week_start AND :week_end AND status != 'cancelled'
--   ORDER BY task_date, start_time;

-- Month view (bind :month as 'YYYY-MM'):
--   SELECT * FROM tasks WHERE task_date LIKE :month || '-%' ORDER BY task_date, start_time;

-- Conflict check before inserting a task (returns any overlapping tasks):
--   SELECT * FROM tasks
--   WHERE task_date = :date AND status != 'cancelled'
--     AND start_time < :new_end AND end_time > :new_start;

-- Busy minutes per day (free time = waking minutes from settings minus this):
--   SELECT task_date,
--          CAST(SUM((julianday('2000-01-01 ' || end_time)
--                  - julianday('2000-01-01 ' || start_time)) * 1440) + 0.5 AS INTEGER) AS busy_minutes
--   FROM tasks
--   WHERE task_date BETWEEN :from AND :to AND status != 'cancelled'
--   GROUP BY task_date;
