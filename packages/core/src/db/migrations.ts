/**
 * Versioned, forward-only migrations. The applied version is stored in SQLite's
 * `user_version` pragma. Never edit a shipped migration; add a new one.
 *
 * Conventions: dates are "YYYY-MM-DD" local dates, times of day are minutes since
 * midnight, timestamps are epoch milliseconds, ids are short text ids.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial",
    sql: `
      CREATE TABLE setting (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE day_template (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        wake_min INTEGER NOT NULL DEFAULT 420,
        bed_min INTEGER NOT NULL DEFAULT 1380
      );

      -- Up to three work blocks per template. "slot" is 1, 2 or 3 in time order;
      -- the name is only a label and can be anything.
      CREATE TABLE template_block (
        template_id TEXT NOT NULL REFERENCES day_template(id) ON DELETE CASCADE,
        slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
        name TEXT NOT NULL,
        start_hour INTEGER NOT NULL CHECK (start_hour BETWEEN 0 AND 23),
        end_hour INTEGER NOT NULL CHECK (end_hour BETWEEN 1 AND 24),
        PRIMARY KEY (template_id, slot),
        CHECK (end_hour > start_hour)
      );

      CREATE TABLE routine_item (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES day_template(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        start_min INTEGER NOT NULL,
        end_min INTEGER,
        position INTEGER NOT NULL DEFAULT 0,
        repeat_rule TEXT
      );
      CREATE INDEX routine_item_template ON routine_item(template_id, start_min);

      CREATE TABLE schedule_rule (
        weekday INTEGER PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
        template_id TEXT NOT NULL REFERENCES day_template(id) ON DELETE CASCADE
      );

      CREATE TABLE date_template (
        date TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES day_template(id) ON DELETE CASCADE
      );

      CREATE TABLE project (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        context TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE deliverable (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('deliverable','milestone','deadline')),
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done'))
      );
      CREATE INDEX deliverable_project ON deliverable(project_id);

      CREATE TABLE task (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES task(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES project(id) ON DELETE SET NULL,
        deliverable_id TEXT REFERENCES deliverable(id) ON DELETE SET NULL,
        series_id TEXT,
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        estimate_pomodoros INTEGER,
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX task_status ON task(status);
      CREATE INDEX task_parent ON task(parent_id);
      CREATE INDEX task_project ON task(project_id);
      CREATE INDEX task_due ON task(due_date) WHERE due_date IS NOT NULL;

      CREATE TABLE task_step (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX task_step_task ON task_step(task_id, position);

      -- A task has at most one assignment: one block on one date.
      CREATE TABLE assignment (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE REFERENCES task(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
        position INTEGER NOT NULL DEFAULT 0,
        repeat_rule TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX assignment_block ON assignment(date, slot, position);

      -- History the weekly report is computed from.
      CREATE TABLE assignment_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('assigned','moved','rolled','unassigned','completed','reopened')),
        from_date TEXT,
        from_slot INTEGER,
        to_date TEXT,
        to_slot INTEGER,
        reason TEXT NOT NULL DEFAULT 'manual' CHECK (reason IN ('manual','rollover','template_change'))
      );
      CREATE INDEX assignment_event_at ON assignment_event(at);
      CREATE INDEX assignment_event_task ON assignment_event(task_id, at);

      CREATE TABLE session (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT,
        start_at INTEGER NOT NULL,
        end_at INTEGER NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('work','break')),
        completed INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX session_start ON session(start_at);
      CREATE INDEX session_task ON session(task_id);

      -- Which block occurrences have already been rolled over (avoids duplicates).
      CREATE TABLE rollover_log (
        date TEXT NOT NULL,
        slot INTEGER NOT NULL,
        processed_at INTEGER NOT NULL,
        PRIMARY KEY (date, slot)
      );
    `,
  },
  {
    version: 2,
    name: "day_adjustments",
    sql: `
      -- A routine item that ran longer or ended early on one date.
      CREATE TABLE routine_override (
        date TEXT NOT NULL,
        item_id TEXT NOT NULL REFERENCES routine_item(id) ON DELETE CASCADE,
        end_min INTEGER NOT NULL,
        PRIMARY KEY (date, item_id)
      );

      -- A work block that was started early on one date.
      CREATE TABLE block_override (
        date TEXT NOT NULL,
        slot INTEGER NOT NULL,
        start_min INTEGER NOT NULL,
        PRIMARY KEY (date, slot)
      );

      -- A date marked as a day off, whatever the week's schedule says.
      CREATE TABLE day_off (
        date TEXT PRIMARY KEY
      );
    `,
  },
  {
    version: 3,
    name: "repeat_series",
    sql: `
      -- A task that comes back on a schedule. The id is the first task's id.
      CREATE TABLE repeat_series (
        id TEXT PRIMARY KEY,
        slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
        rule TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );

      -- The dates a copy was already made for, so a copy that was moved or finished is never made again.
      CREATE TABLE series_occurrence (
        series_id TEXT NOT NULL REFERENCES repeat_series(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        PRIMARY KEY (series_id, date)
      );
    `,
  },
  {
    version: 4,
    name: "any_number_of_blocks",
    sql: `
      -- A day can have as many work blocks as fit in it (up to 12), not just three.
      CREATE TABLE template_block_new (
        template_id TEXT NOT NULL REFERENCES day_template(id) ON DELETE CASCADE,
        slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 12),
        name TEXT NOT NULL,
        start_hour INTEGER NOT NULL CHECK (start_hour BETWEEN 0 AND 23),
        end_hour INTEGER NOT NULL CHECK (end_hour BETWEEN 1 AND 24),
        PRIMARY KEY (template_id, slot),
        CHECK (end_hour > start_hour)
      );
      INSERT INTO template_block_new SELECT template_id, slot, name, start_hour, end_hour FROM template_block;
      DROP TABLE template_block;
      ALTER TABLE template_block_new RENAME TO template_block;

      CREATE TABLE assignment_new (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE REFERENCES task(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 12),
        position INTEGER NOT NULL DEFAULT 0,
        repeat_rule TEXT,
        created_at INTEGER NOT NULL
      );
      INSERT INTO assignment_new SELECT id, task_id, date, slot, position, repeat_rule, created_at FROM assignment;
      DROP TABLE assignment;
      ALTER TABLE assignment_new RENAME TO assignment;
      CREATE INDEX assignment_block ON assignment(date, slot, position);

      -- repeat_series is rebuilt with series_occurrence, so the cascade cannot erase the dates already made.
      CREATE TABLE series_occurrence_keep AS SELECT series_id, date FROM series_occurrence;
      DROP TABLE series_occurrence;
      CREATE TABLE repeat_series_new (
        id TEXT PRIMARY KEY,
        slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 12),
        rule TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO repeat_series_new SELECT id, slot, rule, active FROM repeat_series;
      DROP TABLE repeat_series;
      ALTER TABLE repeat_series_new RENAME TO repeat_series;
      CREATE TABLE series_occurrence (
        series_id TEXT NOT NULL REFERENCES repeat_series(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        PRIMARY KEY (series_id, date)
      );
      INSERT INTO series_occurrence SELECT series_id, date FROM series_occurrence_keep;
      DROP TABLE series_occurrence_keep;
    `,
  },
  {
    version: 5,
    name: "meetings",
    sql: `
      -- A meeting on one day, or the first of a repeating series (the rule is applied on read).
      CREATE TABLE meeting (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        start_min INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
        end_min INTEGER NOT NULL CHECK (end_min BETWEEN 1 AND 1440),
        link TEXT,
        notes TEXT NOT NULL DEFAULT '',
        attendees TEXT NOT NULL DEFAULT '[]',
        repeat_rule TEXT,
        created_at INTEGER NOT NULL,
        CHECK (end_min > start_min)
      );
      CREATE INDEX meeting_date ON meeting(date);

      -- One day of a repeating meeting that was removed on its own.
      CREATE TABLE meeting_skip (
        meeting_id TEXT NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        PRIMARY KEY (meeting_id, date)
      );
    `,
  },
  {
    version: 6,
    name: "meeting_kind_and_minutes",
    sql: `
      ALTER TABLE meeting ADD COLUMN kind TEXT NOT NULL DEFAULT 'online';
      ALTER TABLE meeting ADD COLUMN place TEXT;

      -- What was said, kept for each day a meeting happened on, so a repeating meeting has its own minutes every time.
      CREATE TABLE meeting_minutes (
        meeting_id TEXT NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        text TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (meeting_id, date)
      );
    `,
  },
  {
    version: 7,
    name: "block_extension",
    sql: `
      -- A work block that runs later than planned on one date.
      CREATE TABLE block_extension (
        date TEXT NOT NULL,
        slot INTEGER NOT NULL,
        end_min INTEGER NOT NULL,
        PRIMARY KEY (date, slot)
      );
    `,
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
