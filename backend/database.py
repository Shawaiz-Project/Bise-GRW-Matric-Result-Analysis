"""
database.py — SQLite schema, connection management, and helpers.

All DB access in this project goes through get_db() or the functions
defined here.  The database lives at  data/results.db  (relative to the
project root) unless overridden by the DB_PATH environment variable.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("DB_PATH", str(PROJECT_ROOT / "data" / "results.db")))


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------

def _connect() -> sqlite3.Connection:
    """Return a new SQLite connection with sensible defaults."""
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row          # rows accessible as dicts
    conn.execute("PRAGMA journal_mode=WAL")  # concurrent reads + writes
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-32000")  # 32 MB page cache
    return conn


@contextmanager
def get_db():
    """Yield a database connection and guarantee it is closed afterwards."""
    conn = _connect()
    try:
        yield conn
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

SCHEMA_SQL = """
-- -----------------------------------------------------------------------
-- datasets  — one row per uploaded / processed Excel file
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS datasets (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    year         INTEGER NOT NULL,
    exam_type    TEXT    NOT NULL DEFAULT 'Annual',
    file_name    TEXT    NOT NULL,
    total_students INTEGER,
    processed_at TEXT,                       -- ISO-8601 timestamp
    status       TEXT    NOT NULL DEFAULT 'active'
);

-- -----------------------------------------------------------------------
-- students  — one row per candidate extracted from the Students sheet
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id          INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    roll_no             TEXT    NOT NULL,
    name                TEXT,
    candidate_type      TEXT,
    institution_code    TEXT,
    institution_name    TEXT,
    status              TEXT,
    marks               INTEGER,
    max_marks           INTEGER,
    percentage          REAL,
    grade               TEXT,
    failed_count        INTEGER DEFAULT 0,
    part1_subjects      TEXT,   -- comma-separated subject names
    part2_subjects      TEXT,
    all_failed_subjects TEXT,
    status_flags        TEXT,
    raw_result          TEXT,
    pdf_page            INTEGER,
    pdf_column          INTEGER,
    unknown_items       TEXT
);

-- -----------------------------------------------------------------------
-- subject_failures  — pre-aggregated from Subject_Failures sheet
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subject_failures (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id      INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    subject_code    TEXT,
    subject_name    TEXT    NOT NULL,
    part1_entries   INTEGER DEFAULT 0,
    part2_entries   INTEGER DEFAULT 0,
    total_entries   INTEGER DEFAULT 0,
    unique_students INTEGER DEFAULT 0
);

-- -----------------------------------------------------------------------
-- institution_summary  — pre-aggregated from Institute_Summary sheet
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS institution_summary (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id        INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    institution_code  TEXT,
    institution_name  TEXT    NOT NULL,
    candidates        INTEGER DEFAULT 0,
    passed            INTEGER DEFAULT 0,
    fail_slip         INTEGER DEFAULT 0,
    absent            INTEGER DEFAULT 0,
    result_later      INTEGER DEFAULT 0,
    other_count       INTEGER DEFAULT 0,
    pass_percentage   REAL,
    average_marks     REAL,
    highest_marks     INTEGER,
    -- Computed ranking score: 50% pass_rate + 30% avg_marks_norm + 20% top_performance_norm
    ranking_score     REAL
);

-- -----------------------------------------------------------------------
-- analytics_cache  — precomputed aggregates stored as JSON
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_cache (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id  INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    cache_key   TEXT    NOT NULL,
    value_json  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL,
    UNIQUE(dataset_id, cache_key)
);

-- -----------------------------------------------------------------------
-- data_quality  — one row per quality check extracted from Data_Quality sheet
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_quality (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    check_name TEXT    NOT NULL,
    value      TEXT,
    notes      TEXT
);

-- -----------------------------------------------------------------------
-- status_summary  — per-status student counts
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS status_summary (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id          INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    status              TEXT    NOT NULL,
    student_count       INTEGER DEFAULT 0,
    percent_extracted   REAL,
    percent_appeared    REAL
);

-- -----------------------------------------------------------------------
-- candidate_types  — per-type pass/fail counts
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candidate_types (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id     INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    candidate_type TEXT    NOT NULL,
    extracted      INTEGER DEFAULT 0,
    passed         INTEGER DEFAULT 0,
    not_passed     INTEGER DEFAULT 0,
    pass_percentage REAL
);

-- -----------------------------------------------------------------------
-- marks_distribution  — histogram ranges + grade distribution
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marks_distribution (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL,   -- 'range' or 'grade'
    label      TEXT    NOT NULL,
    students   INTEGER DEFAULT 0,
    percent    REAL
);

-- -----------------------------------------------------------------------
-- top_students  — top performers list
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS top_students (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id       INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    rank_no          INTEGER,
    roll_no          TEXT,
    name             TEXT,
    marks            INTEGER,
    percentage       REAL,
    grade            TEXT,
    institution_code TEXT,
    institution_name TEXT
);
"""

INDEXES_SQL = """
CREATE INDEX IF NOT EXISTS idx_students_roll        ON students(roll_no);
CREATE INDEX IF NOT EXISTS idx_students_dataset     ON students(dataset_id);
CREATE INDEX IF NOT EXISTS idx_students_status      ON students(status);
CREATE INDEX IF NOT EXISTS idx_students_grade       ON students(grade);
CREATE INDEX IF NOT EXISTS idx_students_marks       ON students(marks);
CREATE INDEX IF NOT EXISTS idx_students_percentage  ON students(percentage);
CREATE INDEX IF NOT EXISTS idx_students_inst_code   ON students(institution_code);
CREATE INDEX IF NOT EXISTS idx_students_name        ON students(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_institutions_dataset ON institution_summary(dataset_id);
CREATE INDEX IF NOT EXISTS idx_institutions_code    ON institution_summary(institution_code);
CREATE INDEX IF NOT EXISTS idx_sf_dataset           ON subject_failures(dataset_id);
CREATE INDEX IF NOT EXISTS idx_cache_key            ON analytics_cache(dataset_id, cache_key);
"""


def init_db() -> None:
    """Create all tables and indexes if they do not already exist."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        conn.executescript(SCHEMA_SQL)
        conn.executescript(INDEXES_SQL)
        conn.commit()
    print(f"[DB] Initialised database at {DB_PATH}")


# ---------------------------------------------------------------------------
# Convenience query helpers
# ---------------------------------------------------------------------------

def query_one(sql: str, params: tuple = ()) -> sqlite3.Row | None:
    """Execute *sql* and return the first row, or None."""
    with get_db() as conn:
        return conn.execute(sql, params).fetchone()


def query_all(sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    """Execute *sql* and return all rows."""
    with get_db() as conn:
        return conn.execute(sql, params).fetchall()


def execute(sql: str, params: tuple = ()) -> None:
    """Execute a write statement and commit."""
    with get_db() as conn:
        conn.execute(sql, params)
        conn.commit()


def get_latest_dataset_id() -> int | None:
    """Return the id of the most recently processed active dataset."""
    row = query_one(
        "SELECT id FROM datasets WHERE status='active' ORDER BY processed_at DESC LIMIT 1"
    )
    return row["id"] if row else None


if __name__ == "__main__":
    init_db()
