"""
process_data.py — ETL pipeline: Excel workbook → SQLite database.

Usage:
    python backend/process_data.py
    python backend/process_data.py --file data/MA_2026_results_analysis.xlsx
    python backend/process_data.py --file data/MA_2025.xlsx --year 2025

Run this script once after placing the Excel workbook in the data/ folder.
Re-run it whenever a new year's dataset is added; it will add a new dataset
row without touching existing ones.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Setup — ensure imports resolve whether run from project root or backend/
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    import pandas as pd
    import openpyxl  # noqa: F401 — validates openpyxl is available for xlsx
except ImportError as exc:
    print(f"ERROR: Missing dependency — {exc}")
    print("Install with:  pip install pandas openpyxl")
    sys.exit(1)

from backend.database import DB_PATH, get_db, init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("process_data")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DEFAULT_EXCEL = PROJECT_ROOT / "data" / "MA_2026_results_analysis.xlsx"
BATCH_SIZE = 2000   # rows per INSERT batch


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def _clean(value) -> str:
    """Return a stripped string; None/NaN → empty string."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def _int(value) -> int | None:
    """Convert to int; return None if not numeric."""
    try:
        v = float(str(value).replace(",", "").replace("%", ""))
        return int(v)
    except (ValueError, TypeError):
        return None


def _float(value) -> float | None:
    """Convert to float; handle % suffix; return None if not numeric."""
    try:
        s = str(value).strip().replace(",", "")
        if s.endswith("%"):
            s = s[:-1]
        v = float(s)
        # If value was a 0-1 proportion, scale to 0-100
        if abs(v) <= 1.000001 and not s.endswith("%"):
            return v * 100
        return v
    except (ValueError, TypeError):
        return None


def _grade(percentage: float | None) -> str:
    """Calculate grade from percentage (Pakistani SSC grading)."""
    if percentage is None:
        return ""
    if percentage >= 90:
        return "A+"
    if percentage >= 80:
        return "A"
    if percentage >= 70:
        return "B"
    if percentage >= 60:
        return "C"
    if percentage >= 50:
        return "D"
    if percentage >= 40:
        return "E"
    return "F"


def _col(df: pd.DataFrame, *candidates: str) -> str | None:
    """Return the first column name from *candidates* that exists in df."""
    lower_map = {c.lower(): c for c in df.columns}
    for cand in candidates:
        col = lower_map.get(cand.lower())
        if col is not None:
            return col
    return None


# ---------------------------------------------------------------------------
# Sheet parsers
# ---------------------------------------------------------------------------

def _parse_students(wb_path: Path) -> pd.DataFrame:
    """Read the Students sheet and return a normalised DataFrame."""
    log.info("Reading Students sheet …")
    df = pd.read_excel(wb_path, sheet_name="Students", dtype=str)
    df.columns = [str(c).strip() for c in df.columns]
    df = df.dropna(how="all")

    # Column aliases
    alias = {
        "roll_no": _col(df, "Roll No", "Roll Number", "Roll No."),
        "name": _col(df, "Candidate Name", "Student Name", "Name"),
        "candidate_type": _col(df, "Candidate Type", "Type"),
        "institution_code": _col(df, "Institution Code", "School Code"),
        "institution_name": _col(df, "Institution Name", "School Name"),
        "status": _col(df, "Status", "Result Status"),
        "marks": _col(df, "Marks", "Obtained Marks"),
        "max_marks": _col(df, "Max Marks Assumption", "Maximum Marks"),
        "percentage": _col(df, "Percentage", "Percent"),
        "grade": _col(df, "Grade"),
        "failed_count": _col(df, "Failed Subject Count", "Number of Failed Subjects"),
        "part1_subjects": _col(df, "Failed Subjects - Part I Names", "Part-I Failed Subject Names"),
        "part2_subjects": _col(df, "Failed Subjects - Part II Names", "Part-II Failed Subject Names"),
        "all_failed_subjects": _col(df, "All Failed Subject Names", "All Failed Subjects"),
        "status_flags": _col(df, "Status Flags"),
        "raw_result": _col(df, "Raw Result", "Original Result Text"),
        "pdf_page": _col(df, "PDF Page", "PDF Page Number"),
        "pdf_column": _col(df, "PDF Column"),
        "unknown_items": _col(df, "Unknown Parsed Items", "Unknown Items"),
    }

    required = ["roll_no", "status"]
    missing = [k for k in required if alias[k] is None]
    if missing:
        raise ValueError(f"Students sheet is missing required columns: {missing}")

    out = pd.DataFrame()
    out["roll_no"] = df[alias["roll_no"]].apply(_clean)
    out = out[out["roll_no"] != ""]  # drop blank rows

    def col_or_empty(key):
        c = alias.get(key)
        return df[c].apply(_clean) if c else pd.Series([""] * len(df))

    out["name"] = col_or_empty("name").values[: len(out)]
    out["candidate_type"] = col_or_empty("candidate_type").values[: len(out)]
    out["institution_code"] = col_or_empty("institution_code").values[: len(out)]
    out["institution_name"] = col_or_empty("institution_name").values[: len(out)]
    out["status"] = col_or_empty("status").values[: len(out)]
    out["status"] = out["status"].replace("", "UNKNOWN")

    marks_raw = df[alias["marks"]].apply(_clean) if alias["marks"] else pd.Series([""] * len(df))
    out["marks"] = marks_raw.values[: len(out)]

    max_marks_raw = df[alias["max_marks"]].apply(_clean) if alias["max_marks"] else pd.Series([""] * len(df))
    out["max_marks"] = max_marks_raw.values[: len(out)]

    pct_raw = df[alias["percentage"]].apply(_clean) if alias["percentage"] else pd.Series([""] * len(df))
    out["percentage_raw"] = pct_raw.values[: len(out)]

    grade_raw = col_or_empty("grade").values[: len(out)]
    out["grade_raw"] = grade_raw

    out["failed_count"] = col_or_empty("failed_count").values[: len(out)]
    out["part1_subjects"] = col_or_empty("part1_subjects").values[: len(out)]
    out["part2_subjects"] = col_or_empty("part2_subjects").values[: len(out)]
    out["all_failed_subjects"] = col_or_empty("all_failed_subjects").values[: len(out)]
    out["status_flags"] = col_or_empty("status_flags").values[: len(out)]
    out["raw_result"] = col_or_empty("raw_result").values[: len(out)]
    out["pdf_page"] = col_or_empty("pdf_page").values[: len(out)]
    out["pdf_column"] = col_or_empty("pdf_column").values[: len(out)]
    out["unknown_items"] = col_or_empty("unknown_items").values[: len(out)]

    log.info(f"Students sheet: {len(out):,} rows loaded")
    return out


def _parse_simple_sheet(wb_path: Path, sheet_name: str) -> pd.DataFrame | None:
    """Read a simple table sheet; return None if missing."""
    try:
        df = pd.read_excel(wb_path, sheet_name=sheet_name, dtype=str)
        df.columns = [str(c).strip() for c in df.columns]
        return df.dropna(how="all")
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Insert helpers
# ---------------------------------------------------------------------------

def _insert_students(conn: sqlite3.Connection, students_df: pd.DataFrame, dataset_id: int) -> None:
    log.info("Inserting student records …")

    sql = """
        INSERT INTO students (
            dataset_id, roll_no, name, candidate_type,
            institution_code, institution_name, status,
            marks, max_marks, percentage, grade, failed_count,
            part1_subjects, part2_subjects, all_failed_subjects,
            status_flags, raw_result, pdf_page, pdf_column, unknown_items
        ) VALUES (
            ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        )
    """

    batch: list[tuple] = []
    inserted = 0

    for _, row in students_df.iterrows():
        marks = _int(row.get("marks", ""))
        max_marks = _int(row.get("max_marks", ""))
        pct_val = _float(row.get("percentage_raw", ""))

        # Compute percentage from marks if not directly available
        if pct_val is None and marks is not None and max_marks and max_marks > 0:
            pct_val = round(marks / max_marks * 100, 2)

        # Grade — prefer explicit; compute as fallback
        grade = _clean(row.get("grade_raw", ""))
        if not grade:
            grade = _grade(pct_val)

        rec = (
            dataset_id,
            _clean(row["roll_no"]),
            _clean(row.get("name", "")),
            _clean(row.get("candidate_type", "")),
            _clean(row.get("institution_code", "")),
            _clean(row.get("institution_name", "")),
            _clean(row.get("status", "UNKNOWN")),
            marks,
            max_marks,
            pct_val,
            grade,
            _int(row.get("failed_count", "")) or 0,
            _clean(row.get("part1_subjects", "")),
            _clean(row.get("part2_subjects", "")),
            _clean(row.get("all_failed_subjects", "")),
            _clean(row.get("status_flags", "")),
            _clean(row.get("raw_result", "")),
            _int(row.get("pdf_page", "")),
            _int(row.get("pdf_column", "")),
            _clean(row.get("unknown_items", "")),
        )
        batch.append(rec)

        if len(batch) >= BATCH_SIZE:
            conn.executemany(sql, batch)
            inserted += len(batch)
            batch = []
            log.info(f"  … inserted {inserted:,} students")

    if batch:
        conn.executemany(sql, batch)
        inserted += len(batch)

    conn.commit()
    log.info(f"Student insert complete: {inserted:,} records")


def _insert_subject_failures(conn: sqlite3.Connection, wb_path: Path, dataset_id: int) -> None:
    df = _parse_simple_sheet(wb_path, "Subject_Failures")
    if df is None or df.empty:
        log.warning("Subject_Failures sheet not found — skipping")
        return

    sql = """INSERT INTO subject_failures
             (dataset_id, subject_code, subject_name, part1_entries,
              part2_entries, total_entries, unique_students)
             VALUES (?,?,?,?,?,?,?)"""

    rows = []
    for _, row in df.iterrows():
        code = _clean(row.get("Subject Code", ""))
        name = _clean(row.get("Subject Name", ""))
        if not code and not name:
            continue
        rows.append((
            dataset_id,
            code,
            name or code,
            _int(row.get("Part I Entries", "")) or 0,
            _int(row.get("Part II Entries", "")) or 0,
            _int(row.get("Total Entries", "")) or 0,
            _int(row.get("Unique Students", "")) or 0,
        ))

    conn.executemany(sql, rows)
    conn.commit()
    log.info(f"Subject failures: {len(rows)} subjects inserted")


def _insert_institutions(conn: sqlite3.Connection, wb_path: Path, dataset_id: int) -> None:
    df = _parse_simple_sheet(wb_path, "Institute_Summary")
    if df is None or df.empty:
        log.warning("Institute_Summary sheet not found — skipping")
        return

    sql = """INSERT INTO institution_summary
             (dataset_id, institution_code, institution_name,
              candidates, passed, fail_slip, absent, result_later,
              other_count, pass_percentage, average_marks, highest_marks)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"""

    rows = []
    for _, row in df.iterrows():
        code = _clean(row.get("Institution Code", ""))
        name = _clean(row.get("Institution Name", ""))
        if not code and not name:
            continue
        rows.append((
            dataset_id,
            code,
            name or code,
            _int(row.get("Candidates", "")) or 0,
            _int(row.get("Passed", "")) or 0,
            _int(row.get("Fail/Slip", "")) or 0,
            _int(row.get("Absent", "")) or 0,
            _int(row.get("Result Later", "")) or 0,
            _int(row.get("Other", "")) or 0,
            _float(row.get("Pass %", "")),
            _float(row.get("Average Marks (passed)", "")),
            _int(row.get("Highest Marks", "")),
        ))

    conn.executemany(sql, rows)
    conn.commit()
    log.info(f"Institutions: {len(rows)} rows inserted")


def _insert_status_summary(conn: sqlite3.Connection, wb_path: Path, dataset_id: int,
                            total_extracted: int, appeared: int) -> None:
    df = _parse_simple_sheet(wb_path, "Status_Summary")
    if df is None or df.empty:
        return

    sql = """INSERT INTO status_summary
             (dataset_id, status, student_count, percent_extracted, percent_appeared)
             VALUES (?,?,?,?,?)"""

    rows = []
    for _, row in df.iterrows():
        status = _clean(row.get("Status", ""))
        if not status:
            continue
        count = _int(row.get("Students", "")) or 0
        pct_ext = _float(row.get("% of extracted", ""))
        pct_app = _float(row.get("% of appeared", ""))
        if pct_ext is None and total_extracted:
            pct_ext = round(count / total_extracted * 100, 2)
        if pct_app is None and appeared:
            pct_app = round(count / appeared * 100, 2)
        rows.append((dataset_id, status, count, pct_ext, pct_app))

    conn.executemany(sql, rows)
    conn.commit()
    log.info(f"Status summary: {len(rows)} statuses inserted")


def _insert_candidate_types(conn: sqlite3.Connection, wb_path: Path, dataset_id: int) -> None:
    df = _parse_simple_sheet(wb_path, "Candidate_Type")
    if df is None or df.empty:
        return

    sql = """INSERT INTO candidate_types
             (dataset_id, candidate_type, extracted, passed, not_passed, pass_percentage)
             VALUES (?,?,?,?,?,?)"""

    rows = []
    for _, row in df.iterrows():
        ctype = _clean(row.get("Candidate Type", ""))
        if not ctype:
            continue
        rows.append((
            dataset_id,
            ctype,
            _int(row.get("Extracted", "")) or 0,
            _int(row.get("Passed", "")) or 0,
            _int(row.get("Not Passed / Other", "")) or 0,
            _float(row.get("Pass %", "")),
        ))

    conn.executemany(sql, rows)
    conn.commit()
    log.info(f"Candidate types: {len(rows)} types inserted")


def _insert_marks_distribution(conn: sqlite3.Connection, wb_path: Path, dataset_id: int) -> None:
    try:
        rows_raw = pd.read_excel(wb_path, sheet_name="Marks_Distribution",
                                 header=None, dtype=str)
    except Exception:
        log.warning("Marks_Distribution sheet not found — skipping")
        return

    sql = """INSERT INTO marks_distribution (dataset_id, kind, label, students, percent)
             VALUES (?,?,?,?,?)"""

    rows = []
    grade_section = False
    for _, row in rows_raw.iterrows():
        first = _clean(row.iloc[0]) if len(row) > 0 else ""
        if first.lower() == "grade":
            grade_section = True
            continue
        if not first:
            continue

        if not grade_section and re.match(r"^\d+\s*-\s*\d+$", first):
            rows.append((dataset_id, "range", first,
                         _int(row.iloc[1]) or 0 if len(row) > 1 else 0,
                         _float(row.iloc[2]) if len(row) > 2 else None))
        elif grade_section and first in {"A+", "A", "B", "C", "D", "E", "F"}:
            rows.append((dataset_id, "grade", first,
                         _int(row.iloc[1]) or 0 if len(row) > 1 else 0,
                         _float(row.iloc[2]) if len(row) > 2 else None))

    if rows:
        conn.executemany(sql, rows)
        conn.commit()
        log.info(f"Marks distribution: {len(rows)} rows inserted")


def _insert_top_students(conn: sqlite3.Connection, wb_path: Path, dataset_id: int) -> None:
    df = _parse_simple_sheet(wb_path, "Top_Students")
    if df is None or df.empty:
        return

    sql = """INSERT INTO top_students
             (dataset_id, rank_no, roll_no, name, marks, percentage, grade,
              institution_code, institution_name)
             VALUES (?,?,?,?,?,?,?,?,?)"""

    rows = []
    for _, row in df.iterrows():
        roll = _clean(row.get("Roll No", ""))
        if not roll:
            continue
        rows.append((
            dataset_id,
            _int(row.get("Rank", "")) ,
            roll,
            _clean(row.get("Candidate Name", "")),
            _int(row.get("Marks", "")),
            _float(row.get("Percentage", "")),
            _clean(row.get("Grade", "")),
            _clean(row.get("Institution Code", "")),
            _clean(row.get("Institution Name", "")),
        ))

    conn.executemany(sql, rows)
    conn.commit()
    log.info(f"Top students: {len(rows)} rows inserted")


def _insert_data_quality(conn: sqlite3.Connection, wb_path: Path, dataset_id: int) -> None:
    try:
        rows_raw = pd.read_excel(wb_path, sheet_name="Data_Quality",
                                 header=None, dtype=str)
    except Exception:
        log.warning("Data_Quality sheet not found — skipping")
        return

    sql = """INSERT INTO data_quality (dataset_id, check_name, value, notes)
             VALUES (?,?,?,?)"""

    rows = []
    for _, row in rows_raw.iterrows():
        check = _clean(row.iloc[0]) if len(row) > 0 else ""
        if not check or check.lower() in {"check", ""}:
            continue
        if check.lower() == "unknown result item":
            break
        rows.append((
            dataset_id,
            check,
            _clean(row.iloc[1]) if len(row) > 1 else "",
            _clean(row.iloc[2]) if len(row) > 2 else "",
        ))

    if rows:
        conn.executemany(sql, rows)
        conn.commit()
        log.info(f"Data quality: {len(rows)} checks inserted")


# ---------------------------------------------------------------------------
# Analytics cache builder
# ---------------------------------------------------------------------------

def _build_analytics_cache(conn: sqlite3.Connection, dataset_id: int) -> None:
    """Precompute all expensive aggregations and store as JSON."""
    log.info("Building analytics cache …")
    now = datetime.now(timezone.utc).isoformat()

    def cache(key: str, value) -> None:
        conn.execute(
            """INSERT INTO analytics_cache (dataset_id, cache_key, value_json, updated_at)
               VALUES (?,?,?,?)
               ON CONFLICT(dataset_id, cache_key) DO UPDATE
               SET value_json=excluded.value_json, updated_at=excluded.updated_at""",
            (dataset_id, key, json.dumps(value), now),
        )

    # Overall summary
    row = conn.execute("""
        SELECT
            COUNT(*)                                          AS total_extracted,
            SUM(CASE WHEN status NOT IN ('ABSENT','CANCELLED') THEN 1 ELSE 0 END) AS appeared,
            SUM(CASE WHEN status='PASS' THEN 1 ELSE 0 END)   AS passed,
            SUM(CASE WHEN status='FAIL/SLIP' THEN 1 ELSE 0 END) AS fail_slip,
            SUM(CASE WHEN status='ABSENT' THEN 1 ELSE 0 END) AS absent,
            SUM(CASE WHEN status='CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
            MAX(marks)                                         AS highest_marks,
            AVG(CASE WHEN marks IS NOT NULL THEN marks END)   AS average_marks,
            COUNT(DISTINCT institution_code)                   AS school_count
        FROM students WHERE dataset_id=?
    """, (dataset_id,)).fetchone()

    appeared = row["appeared"] or 0
    passed = row["passed"] or 0
    pass_pct = round(passed / appeared * 100, 2) if appeared else None

    summary = {
        "total_extracted": row["total_extracted"],
        "appeared": appeared,
        "passed": passed,
        "not_passed": max(0, appeared - passed),
        "fail_slip": row["fail_slip"] or 0,
        "absent": row["absent"] or 0,
        "cancelled": row["cancelled"] or 0,
        "pass_percentage": pass_pct,
        "highest_marks": row["highest_marks"],
        "average_marks": round(row["average_marks"], 2) if row["average_marks"] else None,
        "school_count": row["school_count"],
    }
    cache("summary", summary)

    # Grade distribution (from marks_distribution table first, then compute)
    grade_rows = conn.execute("""
        SELECT label, students FROM marks_distribution
        WHERE dataset_id=? AND kind='grade' ORDER BY label
    """, (dataset_id,)).fetchall()

    if grade_rows:
        cache("grade_distribution", [dict(r) for r in grade_rows])
    else:
        grade_counts = conn.execute("""
            SELECT grade, COUNT(*) as students
            FROM students WHERE dataset_id=? AND grade != ''
            GROUP BY grade ORDER BY grade
        """, (dataset_id,)).fetchall()
        cache("grade_distribution", [dict(r) for r in grade_counts])

    # Marks range distribution
    range_rows = conn.execute("""
        SELECT label as range_label, students FROM marks_distribution
        WHERE dataset_id=? AND kind='range' ORDER BY CAST(SUBSTR(label,1,INSTR(label,'-')-1) AS INTEGER)
    """, (dataset_id,)).fetchall()
    cache("marks_distribution", [dict(r) for r in range_rows])

    # Status summary
    status_rows = conn.execute("""
        SELECT status, student_count, percent_extracted, percent_appeared
        FROM status_summary WHERE dataset_id=? ORDER BY student_count DESC
    """, (dataset_id,)).fetchall()
    cache("status_summary", [dict(r) for r in status_rows])

    # Top subject failures
    sf_rows = conn.execute("""
        SELECT subject_code, subject_name, part1_entries, part2_entries,
               total_entries, unique_students
        FROM subject_failures WHERE dataset_id=?
        ORDER BY unique_students DESC
    """, (dataset_id,)).fetchall()
    cache("subject_failures", [dict(r) for r in sf_rows])

    # Institution summary
    inst_rows = conn.execute("""
        SELECT institution_code, institution_name, candidates, passed,
               fail_slip, absent, result_later, pass_percentage, average_marks, highest_marks
        FROM institution_summary WHERE dataset_id=?
        ORDER BY candidates DESC
    """, (dataset_id,)).fetchall()
    cache("institutions", [dict(r) for r in inst_rows])

    # Compute institution ranking scores
    inst_list = [dict(r) for r in inst_rows]
    max_avg = max((r["average_marks"] or 0 for r in inst_list), default=1) or 1
    for inst in inst_list:
        pass_score = (inst["pass_percentage"] or 0) * 0.50
        avg_score = ((inst["average_marks"] or 0) / max_avg * 100) * 0.30
        inst["ranking_score"] = round(pass_score + avg_score, 2)
    cache("school_rankings", sorted(inst_list, key=lambda x: x["ranking_score"], reverse=True))

    # Candidate types
    ct_rows = conn.execute("""
        SELECT candidate_type, extracted, passed, not_passed, pass_percentage
        FROM candidate_types WHERE dataset_id=?
        ORDER BY extracted DESC
    """, (dataset_id,)).fetchall()
    cache("candidate_types", [dict(r) for r in ct_rows])

    # Top students
    ts_rows = conn.execute("""
        SELECT rank_no, roll_no, name, marks, percentage, grade,
               institution_code, institution_name
        FROM top_students WHERE dataset_id=? ORDER BY rank_no LIMIT 50
    """, (dataset_id,)).fetchall()
    cache("top_students", [dict(r) for r in ts_rows])

    # Data quality
    dq_rows = conn.execute("""
        SELECT check_name, value, notes FROM data_quality
        WHERE dataset_id=? ORDER BY rowid
    """, (dataset_id,)).fetchall()
    cache("data_quality", [dict(r) for r in dq_rows])

    conn.commit()
    log.info("Analytics cache built ✓")


# ---------------------------------------------------------------------------
# Compute ranking scores for institution_summary table
# ---------------------------------------------------------------------------

def _update_ranking_scores(conn: sqlite3.Connection, dataset_id: int) -> None:
    rows = conn.execute("""
        SELECT id, pass_percentage, average_marks
        FROM institution_summary WHERE dataset_id=?
    """, (dataset_id,)).fetchall()

    avg_vals = [r["average_marks"] for r in rows if r["average_marks"] is not None]
    max_avg = max(avg_vals, default=1) or 1

    updates = []
    for r in rows:
        pass_score = (r["pass_percentage"] or 0) * 0.50
        avg_score = ((r["average_marks"] or 0) / max_avg * 100) * 0.30
        score = round(pass_score + avg_score, 2)
        updates.append((score, r["id"]))

    conn.executemany("UPDATE institution_summary SET ranking_score=? WHERE id=?", updates)
    conn.commit()


# ---------------------------------------------------------------------------
# Quality report
# ---------------------------------------------------------------------------

def _print_quality_report(conn: sqlite3.Connection, dataset_id: int) -> None:
    print("\n" + "=" * 60)
    print("  DATA QUALITY REPORT")
    print("=" * 60)

    r = conn.execute("""
        SELECT COUNT(*) as total,
               SUM(CASE WHEN roll_no='' OR roll_no IS NULL THEN 1 ELSE 0 END) as missing_roll,
               SUM(CASE WHEN name='' OR name IS NULL THEN 1 ELSE 0 END) as missing_name,
               SUM(CASE WHEN marks IS NULL THEN 1 ELSE 0 END) as missing_marks,
               SUM(CASE WHEN percentage IS NULL THEN 1 ELSE 0 END) as missing_pct,
               SUM(CASE WHEN status='PASS' THEN 1 ELSE 0 END) as passed,
               SUM(CASE WHEN status='FAIL/SLIP' THEN 1 ELSE 0 END) as fail_slip,
               SUM(CASE WHEN status='ABSENT' THEN 1 ELSE 0 END) as absent
        FROM students WHERE dataset_id=?
    """, (dataset_id,)).fetchone()

    dup = conn.execute("""
        SELECT COUNT(*) as cnt FROM (
            SELECT roll_no FROM students WHERE dataset_id=?
            GROUP BY roll_no HAVING COUNT(*) > 1
        )
    """, (dataset_id,)).fetchone()["cnt"]

    print(f"  Total records       : {r['total']:,}")
    print(f"  Missing roll no     : {r['missing_roll']:,}")
    print(f"  Missing name        : {r['missing_name']:,}")
    print(f"  Missing marks       : {r['missing_marks']:,}")
    print(f"  Missing percentage  : {r['missing_pct']:,}")
    print(f"  Duplicate roll nos  : {dup:,}")
    print(f"  Passed              : {r['passed']:,}")
    print(f"  Fail/Slip           : {r['fail_slip']:,}")
    print(f"  Absent              : {r['absent']:,}")
    appeared = (r["total"] or 0) - (r["absent"] or 0)
    pass_pct = round(r["passed"] / appeared * 100, 2) if appeared else 0
    print(f"  Pass percentage     : {pass_pct}%")
    print("=" * 60 + "\n")


# ---------------------------------------------------------------------------
# Main ETL function
# ---------------------------------------------------------------------------

def process_excel(excel_path: Path, year: int, exam_type: str = "Annual") -> None:
    """Full ETL: read Excel → init DB → insert all tables → build cache."""
    if not excel_path.exists():
        raise FileNotFoundError(f"Excel file not found: {excel_path}")

    log.info(f"Processing: {excel_path.name}  (year={year}, exam={exam_type})")
    t0 = time.time()

    # Initialise DB schema
    init_db()

    with get_db() as conn:
        # Check if this file has already been processed
        existing = conn.execute(
            "SELECT id FROM datasets WHERE file_name=? AND year=? AND exam_type=?",
            (excel_path.name, year, exam_type),
        ).fetchone()

        if existing:
            answer = input(
                f"\nDataset '{excel_path.name}' (year={year}) already exists (id={existing['id']}).\n"
                "Re-process and replace it? [y/N]: "
            ).strip().lower()
            if answer != "y":
                log.info("Aborted — existing dataset unchanged.")
                return
            # Delete the old dataset (cascade deletes all related rows)
            conn.execute("DELETE FROM datasets WHERE id=?", (existing["id"],))
            conn.commit()
            log.info(f"Deleted existing dataset id={existing['id']}")

        # 1. Parse Students sheet
        students_df = _parse_students(excel_path)
        total_students = len(students_df)

        # 2. Create dataset record
        now_iso = datetime.now(timezone.utc).isoformat()
        cursor = conn.execute(
            """INSERT INTO datasets (year, exam_type, file_name, total_students, processed_at, status)
               VALUES (?,?,?,?,?,'active')""",
            (year, exam_type, excel_path.name, total_students, now_iso),
        )
        dataset_id = cursor.lastrowid
        conn.commit()
        log.info(f"Created dataset id={dataset_id}")

        # 3. Insert all tables
        _insert_students(conn, students_df, dataset_id)

        appeared = int(students_df[~students_df["status"].isin(["ABSENT", "CANCELLED"])].shape[0])

        _insert_subject_failures(conn, excel_path, dataset_id)
        _insert_institutions(conn, excel_path, dataset_id)
        _insert_status_summary(conn, excel_path, dataset_id, total_students, appeared)
        _insert_candidate_types(conn, excel_path, dataset_id)
        _insert_marks_distribution(conn, excel_path, dataset_id)
        _insert_top_students(conn, excel_path, dataset_id)
        _insert_data_quality(conn, excel_path, dataset_id)

        # 4. Compute ranking scores
        _update_ranking_scores(conn, dataset_id)

        # 5. Build analytics cache
        _build_analytics_cache(conn, dataset_id)

        # 6. Quality report
        _print_quality_report(conn, dataset_id)

    elapsed = round(time.time() - t0, 1)
    log.info(f"Done ✓  ({elapsed}s)  DB → {DB_PATH}")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _infer_year(file_path: Path) -> int:
    """Try to find a 4-digit year in the filename; default to current year."""
    match = re.search(r"(20\d{2})", file_path.stem)
    if match:
        return int(match.group(1))
    return datetime.now().year


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Process a BISE GRW result Excel file into the SQLite database."
    )
    parser.add_argument(
        "--file", type=Path, default=DEFAULT_EXCEL,
        help=f"Path to the Excel workbook (default: {DEFAULT_EXCEL})"
    )
    parser.add_argument(
        "--year", type=int, default=None,
        help="Result year (default: inferred from filename)"
    )
    parser.add_argument(
        "--exam-type", default="Annual",
        help="Exam type label, e.g. 'Annual' or 'Supplementary' (default: Annual)"
    )
    args = parser.parse_args()

    excel_path = args.file.resolve()
    year = args.year or _infer_year(excel_path)

    process_excel(excel_path, year=year, exam_type=args.exam_type)


if __name__ == "__main__":
    main()
