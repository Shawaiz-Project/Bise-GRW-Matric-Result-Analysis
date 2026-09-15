"""
routes/api.py — All public REST API endpoints.

All endpoints return JSON.  Pagination, filtering, searching, and sorting
are handled server-side so the frontend never downloads the full dataset.
"""

from __future__ import annotations

import csv
import io
import json
import math
from functools import wraps

from flask import Blueprint, jsonify, request, Response

from backend.database import get_db, get_latest_dataset_id
from backend.analytics import generate_insights

api_bp = Blueprint("api", __name__, url_prefix="/api")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _dataset_id_param() -> int | None:
    """Read ?dataset_id= from query string; fall back to latest active dataset."""
    raw = request.args.get("dataset_id")
    if raw and raw.isdigit():
        return int(raw)
    return get_latest_dataset_id()


def _page_params() -> tuple[int, int]:
    """Return (page, limit) from query string, clamped to safe values."""
    page = max(1, int(request.args.get("page", 1) or 1))
    limit = max(1, min(500, int(request.args.get("limit", 50) or 50)))
    return page, limit


def _cache(conn, dataset_id: int, key: str):
    row = conn.execute(
        "SELECT value_json FROM analytics_cache WHERE dataset_id=? AND cache_key=?",
        (dataset_id, key),
    ).fetchone()
    return json.loads(row["value_json"]) if row else None


def _ok(data) -> Response:
    return jsonify({"ok": True, "data": data})


def _err(message: str, status: int = 400) -> tuple[Response, int]:
    return jsonify({"ok": False, "error": message}), status


def _require_dataset(f):
    """Decorator: inject dataset_id; 404 if no dataset exists."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        dataset_id = _dataset_id_param()
        if dataset_id is None:
            return _err("No dataset found. Run process_data.py first.", 404)
        return f(dataset_id, *args, **kwargs)
    return wrapper


# ---------------------------------------------------------------------------
# /api/datasets
# ---------------------------------------------------------------------------

@api_bp.get("/datasets")
def list_datasets():
    """List all available result datasets."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, year, exam_type, file_name, total_students, processed_at, status "
            "FROM datasets WHERE status='active' ORDER BY year DESC, processed_at DESC"
        ).fetchall()
    return _ok([dict(r) for r in rows])


# ---------------------------------------------------------------------------
# /api/summary
# ---------------------------------------------------------------------------

@api_bp.get("/summary")
@_require_dataset
def summary(dataset_id: int):
    """Return precomputed overall KPIs for the selected dataset."""
    with get_db() as conn:
        data = _cache(conn, dataset_id, "summary")
        if not data:
            return _err("Summary cache not found. Re-run process_data.py.", 404)

        # Also return grade + status distribution
        data["grade_distribution"] = _cache(conn, dataset_id, "grade_distribution") or []
        data["status_summary"] = _cache(conn, dataset_id, "status_summary") or []
        data["marks_distribution"] = _cache(conn, dataset_id, "marks_distribution") or []
        data["candidate_types"] = _cache(conn, dataset_id, "candidate_types") or []

        dataset_info = conn.execute(
            "SELECT year, exam_type, file_name, processed_at FROM datasets WHERE id=?",
            (dataset_id,),
        ).fetchone()
        data["dataset"] = dict(dataset_info) if dataset_info else {}

    return _ok(data)


# ---------------------------------------------------------------------------
# /api/students
# ---------------------------------------------------------------------------

@api_bp.get("/students")
@_require_dataset
def list_students(dataset_id: int):
    """Paginated, filtered, and searchable student list."""
    page, limit = _page_params()
    offset = (page - 1) * limit

    # Filter params
    search = (request.args.get("search") or "").strip()
    search_field = request.args.get("field", "all")  # all|roll|name|school|subject
    status = (request.args.get("status") or "").strip()
    grade = (request.args.get("grade") or "").strip()
    candidate_type = (request.args.get("candidate_type") or "").strip()
    school = (request.args.get("school") or "").strip()
    sort_by = request.args.get("sort", "roll_no")

    try:
        min_marks = float(request.args["min_marks"]) if request.args.get("min_marks") else None
        max_marks = float(request.args["max_marks"]) if request.args.get("max_marks") else None
        min_pct = float(request.args["min_pct"]) if request.args.get("min_pct") else None
        max_pct = float(request.args["max_pct"]) if request.args.get("max_pct") else None
    except ValueError:
        return _err("Invalid numeric filter value")

    # Build WHERE clause
    conditions = ["dataset_id = ?"]
    params: list = [dataset_id]

    if status:
        conditions.append("status = ?")
        params.append(status)
    if grade:
        conditions.append("grade = ?")
        params.append(grade)
    if candidate_type:
        conditions.append("candidate_type = ?")
        params.append(candidate_type)
    if school:
        conditions.append("(institution_name LIKE ? OR institution_code LIKE ?)")
        params += [f"%{school}%", f"%{school}%"]
    if min_marks is not None:
        conditions.append("marks >= ?")
        params.append(int(min_marks))
    if max_marks is not None:
        conditions.append("marks <= ?")
        params.append(int(max_marks))
    if min_pct is not None:
        conditions.append("percentage >= ?")
        params.append(min_pct)
    if max_pct is not None:
        conditions.append("percentage <= ?")
        params.append(max_pct)

    if search:
        term = f"%{search}%"
        if search_field == "roll":
            conditions.append("roll_no LIKE ?")
            params.append(term)
        elif search_field == "name":
            conditions.append("name LIKE ?")
            params.append(term)
        elif search_field == "school":
            conditions.append("(institution_name LIKE ? OR institution_code LIKE ?)")
            params += [term, term]
        elif search_field == "subject":
            conditions.append(
                "(all_failed_subjects LIKE ? OR part1_subjects LIKE ? OR part2_subjects LIKE ?)"
            )
            params += [term, term, term]
        else:  # all
            conditions.append(
                "(roll_no LIKE ? OR name LIKE ? OR institution_name LIKE ? "
                "OR institution_code LIKE ? OR all_failed_subjects LIKE ?)"
            )
            params += [term, term, term, term, term]

    where = " AND ".join(conditions)

    # Validate sort column
    valid_sorts = {
        "roll_no": "roll_no",
        "name": "name COLLATE NOCASE",
        "marks": "marks DESC",
        "percentage": "percentage DESC",
        "grade": "grade",
        "status": "status",
    }
    order = valid_sorts.get(sort_by, "roll_no")

    with get_db() as conn:
        total_row = conn.execute(f"SELECT COUNT(*) FROM students WHERE {where}", params).fetchone()
        total = total_row[0]
        pages = max(1, math.ceil(total / limit))

        rows = conn.execute(
            f"""SELECT roll_no, name, candidate_type, institution_code, institution_name,
                       status, marks, max_marks, percentage, grade, failed_count,
                       part1_subjects, part2_subjects, all_failed_subjects, pdf_page
                FROM students WHERE {where}
                ORDER BY {order}
                LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()

    return _ok({
        "students": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": pages,
    })


# ---------------------------------------------------------------------------
# /api/students/<roll_no>
# ---------------------------------------------------------------------------

@api_bp.get("/students/<roll_no>")
@_require_dataset
def get_student(dataset_id: int, roll_no: str):
    """Return full detail for a single student including rank and percentile."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM students WHERE dataset_id=? AND roll_no=?",
            (dataset_id, roll_no),
        ).fetchone()
        if not row:
            return _err(f"Student '{roll_no}' not found", 404)

        student = dict(row)

        # Compute overall rank (among students with marks)
        if student.get("marks") is not None:
            rank_row = conn.execute(
                "SELECT COUNT(*)+1 as rank FROM students "
                "WHERE dataset_id=? AND marks > ? AND marks IS NOT NULL",
                (dataset_id, student["marks"]),
            ).fetchone()
            student["overall_rank"] = rank_row["rank"] if rank_row else None

            total_with_marks = conn.execute(
                "SELECT COUNT(*) FROM students WHERE dataset_id=? AND marks IS NOT NULL",
                (dataset_id,),
            ).fetchone()[0]
            if total_with_marks and rank_row:
                student["percentile"] = round(
                    (1 - rank_row["rank"] / total_with_marks) * 100, 2
                )
            else:
                student["percentile"] = None

            # School rank
            school_rank_row = conn.execute(
                "SELECT COUNT(*)+1 as rank FROM students "
                "WHERE dataset_id=? AND institution_code=? AND marks > ? AND marks IS NOT NULL",
                (dataset_id, student["institution_code"], student["marks"]),
            ).fetchone()
            student["school_rank"] = school_rank_row["rank"] if school_rank_row else None
        else:
            student["overall_rank"] = None
            student["school_rank"] = None
            student["percentile"] = None

    return _ok(student)


# ---------------------------------------------------------------------------
# /api/schools
# ---------------------------------------------------------------------------

@api_bp.get("/schools")
@_require_dataset
def list_schools(dataset_id: int):
    """Return institution summary, filtered and paginated."""
    page, limit = _page_params()
    offset = (page - 1) * limit
    search = (request.args.get("search") or "").strip()
    min_candidates = int(request.args.get("min_candidates", 0) or 0)
    sort_by = request.args.get("sort", "candidates")

    valid_sorts = {
        "candidates": "candidates DESC",
        "pass_rate": "pass_percentage DESC",
        "average_marks": "average_marks DESC",
        "highest_marks": "highest_marks DESC",
        "ranking": "ranking_score DESC",
        "name": "institution_name COLLATE NOCASE",
    }
    order = valid_sorts.get(sort_by, "candidates DESC")

    conditions = ["dataset_id = ?", "candidates >= ?"]
    params: list = [dataset_id, min_candidates]

    if search:
        conditions.append("(institution_name LIKE ? OR institution_code LIKE ?)")
        params += [f"%{search}%", f"%{search}%"]

    where = " AND ".join(conditions)

    with get_db() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM institution_summary WHERE {where}", params
        ).fetchone()[0]
        pages = max(1, math.ceil(total / limit))

        rows = conn.execute(
            f"""SELECT institution_code, institution_name, candidates, passed, fail_slip,
                       absent, result_later, pass_percentage, average_marks, highest_marks,
                       ranking_score
                FROM institution_summary WHERE {where}
                ORDER BY {order} LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()

    return _ok({
        "schools": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": pages,
    })


# ---------------------------------------------------------------------------
# /api/schools/<institution_code>
# ---------------------------------------------------------------------------

@api_bp.get("/schools/<institution_code>")
@_require_dataset
def get_school(dataset_id: int, institution_code: str):
    """Return detail for a single school including top students."""
    with get_db() as conn:
        school = conn.execute(
            "SELECT * FROM institution_summary WHERE dataset_id=? AND institution_code=?",
            (dataset_id, institution_code),
        ).fetchone()
        if not school:
            return _err(f"School '{institution_code}' not found", 404)

        top = conn.execute(
            """SELECT roll_no, name, marks, percentage, grade
               FROM students WHERE dataset_id=? AND institution_code=? AND marks IS NOT NULL
               ORDER BY marks DESC LIMIT 10""",
            (dataset_id, institution_code),
        ).fetchall()

    return _ok({
        "school": dict(school),
        "top_students": [dict(r) for r in top],
    })


# ---------------------------------------------------------------------------
# /api/subjects
# ---------------------------------------------------------------------------

@api_bp.get("/subjects")
@_require_dataset
def list_subjects(dataset_id: int):
    """Return subject failure analytics."""
    search = (request.args.get("search") or "").strip()
    sort_by = request.args.get("sort", "unique_students")

    valid_sorts = {
        "unique_students": "unique_students DESC",
        "total": "total_entries DESC",
        "part1": "part1_entries DESC",
        "part2": "part2_entries DESC",
        "name": "subject_name COLLATE NOCASE",
    }
    order = valid_sorts.get(sort_by, "unique_students DESC")

    conditions = ["dataset_id = ?"]
    params: list = [dataset_id]
    if search:
        conditions.append("(subject_name LIKE ? OR subject_code LIKE ?)")
        params += [f"%{search}%", f"%{search}%"]

    where = " AND ".join(conditions)

    with get_db() as conn:
        rows = conn.execute(
            f"""SELECT subject_code, subject_name, part1_entries, part2_entries,
                       total_entries, unique_students
                FROM subject_failures WHERE {where} ORDER BY {order}""",
            params,
        ).fetchall()

    return _ok({"subjects": [dict(r) for r in rows]})


# ---------------------------------------------------------------------------
# /api/top-students
# ---------------------------------------------------------------------------

@api_bp.get("/top-students")
@_require_dataset
def top_students_endpoint(dataset_id: int):
    """Return top N students from the pre-aggregated top_students table."""
    limit = min(100, int(request.args.get("limit", 15) or 15))
    with get_db() as conn:
        # Try top_students table first
        rows = conn.execute(
            """SELECT rank_no, roll_no, name, marks, percentage, grade,
                      institution_code, institution_name
               FROM top_students WHERE dataset_id=? ORDER BY rank_no LIMIT ?""",
            (dataset_id, limit),
        ).fetchall()

        if not rows:
            # Fall back to computing from students table
            rows = conn.execute(
                """SELECT NULL as rank_no, roll_no, name, marks, percentage, grade,
                          institution_code, institution_name
                   FROM students WHERE dataset_id=? AND marks IS NOT NULL
                   ORDER BY marks DESC LIMIT ?""",
                (dataset_id, limit),
            ).fetchall()

    return _ok([dict(r) for r in rows])


# ---------------------------------------------------------------------------
# /api/rankings/schools
# ---------------------------------------------------------------------------

@api_bp.get("/rankings/schools")
@_require_dataset
def school_rankings(dataset_id: int):
    """Return schools ranked by weighted score. Only schools with >=20 candidates."""
    min_candidates = int(request.args.get("min_candidates", 20) or 20)
    limit = min(500, int(request.args.get("limit", 100) or 100))

    with get_db() as conn:
        rows = conn.execute(
            """SELECT institution_code, institution_name, candidates, passed,
                      pass_percentage, average_marks, highest_marks, ranking_score
               FROM institution_summary
               WHERE dataset_id=? AND candidates >= ?
               ORDER BY ranking_score DESC LIMIT ?""",
            (dataset_id, min_candidates, limit),
        ).fetchall()

    # Add rank number
    result = []
    for i, row in enumerate(rows, start=1):
        item = dict(row)
        item["rank"] = i
        result.append(item)

    return _ok(result)


# ---------------------------------------------------------------------------
# /api/insights
# ---------------------------------------------------------------------------

@api_bp.get("/insights")
@_require_dataset
def insights_endpoint(dataset_id: int):
    """Return dynamically generated insights."""
    insight_list = generate_insights(dataset_id)
    return _ok(insight_list)


# ---------------------------------------------------------------------------
# /api/quality
# ---------------------------------------------------------------------------

@api_bp.get("/quality")
@_require_dataset
def quality_endpoint(dataset_id: int):
    """Return data quality checks."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT check_name, value, notes FROM data_quality WHERE dataset_id=? ORDER BY rowid",
            (dataset_id,),
        ).fetchall()
    return _ok([dict(r) for r in rows])


# ---------------------------------------------------------------------------
# /api/analytics/grades
# ---------------------------------------------------------------------------

@api_bp.get("/analytics/grades")
@_require_dataset
def analytics_grades(dataset_id: int):
    with get_db() as conn:
        data = _cache(conn, dataset_id, "grade_distribution") or []
    return _ok(data)


# ---------------------------------------------------------------------------
# /api/analytics/status
# ---------------------------------------------------------------------------

@api_bp.get("/analytics/status")
@_require_dataset
def analytics_status(dataset_id: int):
    with get_db() as conn:
        data = _cache(conn, dataset_id, "status_summary") or []
    return _ok(data)


# ---------------------------------------------------------------------------
# /api/analytics/marks
# ---------------------------------------------------------------------------

@api_bp.get("/analytics/marks")
@_require_dataset
def analytics_marks(dataset_id: int):
    with get_db() as conn:
        data = _cache(conn, dataset_id, "marks_distribution") or []
    return _ok(data)


# ---------------------------------------------------------------------------
# /api/filter-options
# ---------------------------------------------------------------------------

@api_bp.get("/filter-options")
@_require_dataset
def filter_options(dataset_id: int):
    """Return distinct values for filter dropdowns."""
    with get_db() as conn:
        statuses = [r[0] for r in conn.execute(
            "SELECT DISTINCT status FROM students WHERE dataset_id=? AND status!='' ORDER BY status",
            (dataset_id,),
        ).fetchall()]
        types = [r[0] for r in conn.execute(
            "SELECT DISTINCT candidate_type FROM students WHERE dataset_id=? AND candidate_type!='' ORDER BY candidate_type",
            (dataset_id,),
        ).fetchall()]
        grades = [r[0] for r in conn.execute(
            "SELECT DISTINCT grade FROM students WHERE dataset_id=? AND grade!='' ORDER BY grade",
            (dataset_id,),
        ).fetchall()]

    return _ok({"statuses": statuses, "candidate_types": types, "grades": grades})


# ---------------------------------------------------------------------------
# /api/export/students.csv
# ---------------------------------------------------------------------------

@api_bp.get("/export/students.csv")
@_require_dataset
def export_students_csv(dataset_id: int):
    """Server-side CSV export with full filter support (no row limit)."""
    search = (request.args.get("search") or "").strip()
    search_field = request.args.get("field", "all")
    status = (request.args.get("status") or "").strip()
    grade = (request.args.get("grade") or "").strip()
    candidate_type = (request.args.get("candidate_type") or "").strip()
    school = (request.args.get("school") or "").strip()

    conditions = ["dataset_id = ?"]
    params: list = [dataset_id]

    if status:
        conditions.append("status = ?")
        params.append(status)
    if grade:
        conditions.append("grade = ?")
        params.append(grade)
    if candidate_type:
        conditions.append("candidate_type = ?")
        params.append(candidate_type)
    if school:
        conditions.append("(institution_name LIKE ? OR institution_code LIKE ?)")
        params += [f"%{school}%", f"%{school}%"]
    if search:
        term = f"%{search}%"
        if search_field == "roll":
            conditions.append("roll_no LIKE ?")
            params.append(term)
        elif search_field == "name":
            conditions.append("name LIKE ?")
            params.append(term)
        elif search_field == "school":
            conditions.append("(institution_name LIKE ? OR institution_code LIKE ?)")
            params += [term, term]
        else:
            conditions.append(
                "(roll_no LIKE ? OR name LIKE ? OR institution_name LIKE ? OR all_failed_subjects LIKE ?)"
            )
            params += [term, term, term, term]

    where = " AND ".join(conditions)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Roll No", "Candidate Name", "Candidate Type",
        "Institution Code", "Institution Name",
        "Status", "Marks", "Max Marks", "Percentage", "Grade",
        "Failed Subject Count", "Part-I Subjects", "Part-II Subjects",
        "All Failed Subjects", "PDF Page",
    ])

    with get_db() as conn:
        rows = conn.execute(
            f"""SELECT roll_no, name, candidate_type, institution_code, institution_name,
                       status, marks, max_marks, percentage, grade, failed_count,
                       part1_subjects, part2_subjects, all_failed_subjects, pdf_page
                FROM students WHERE {where} ORDER BY roll_no""",
            params,
        ).fetchall()

    for row in rows:
        writer.writerow([row[i] if row[i] is not None else "" for i in range(15)])

    output.seek(0)
    return Response(
        "\ufeff" + output.getvalue(),   # BOM for Excel compatibility
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=students_export.csv"},
    )
