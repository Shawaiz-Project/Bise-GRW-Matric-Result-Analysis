"""
routes/admin.py — Admin panel routes for dataset management and upload.

Protected by ADMIN_PASSWORD environment variable.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from functools import wraps
from pathlib import Path

from flask import Blueprint, jsonify, request, Response

from backend.database import get_db, PROJECT_ROOT

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")

UPLOAD_DIR = PROJECT_ROOT / "data" / "uploads"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin2026")


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def _require_auth(f):
    """Simple bearer-token auth via ADMIN_PASSWORD env variable."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        token = auth.removeprefix("Bearer ").strip()
        if token != ADMIN_PASSWORD:
            return jsonify({"ok": False, "error": "Unauthorised"}), 401
        return f(*args, **kwargs)
    return wrapper


# ---------------------------------------------------------------------------
# /admin/datasets
# ---------------------------------------------------------------------------

@admin_bp.get("/datasets")
@_require_auth
def list_datasets():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, year, exam_type, file_name, total_students, processed_at, status "
            "FROM datasets ORDER BY processed_at DESC"
        ).fetchall()
    return jsonify({"ok": True, "data": [dict(r) for r in rows]})


@admin_bp.delete("/datasets/<int:dataset_id>")
@_require_auth
def delete_dataset(dataset_id: int):
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM datasets WHERE id=?", (dataset_id,)
        ).fetchone()
        if not existing:
            return jsonify({"ok": False, "error": "Dataset not found"}), 404
        conn.execute("DELETE FROM datasets WHERE id=?", (dataset_id,))
        conn.commit()
    return jsonify({"ok": True, "message": f"Dataset {dataset_id} deleted."})


# ---------------------------------------------------------------------------
# /admin/upload  — upload + trigger ETL
# ---------------------------------------------------------------------------

@admin_bp.post("/upload")
@_require_auth
def upload_dataset():
    """Accept an Excel file upload, save it, and trigger the ETL pipeline."""
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        return jsonify({"ok": False, "error": "Only .xlsx or .xls files are accepted"}), 400

    year = request.form.get("year", "")
    exam_type = request.form.get("exam_type", "Annual").strip() or "Annual"

    if not year.isdigit() or not (2000 <= int(year) <= 2100):
        return jsonify({"ok": False, "error": "Provide a valid year (2000–2100)"}), 400

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    save_path = UPLOAD_DIR / file.filename
    file.save(str(save_path))

    # Trigger ETL as a subprocess (non-blocking on PythonAnywhere free tier)
    cmd = [
        sys.executable, str(PROJECT_ROOT / "backend" / "process_data.py"),
        "--file", str(save_path),
        "--year", year,
        "--exam-type", exam_type,
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            return jsonify({
                "ok": False,
                "error": "ETL pipeline failed",
                "details": result.stderr[-2000:],
            }), 500
        return jsonify({
            "ok": True,
            "message": f"Dataset processed successfully for year {year}.",
            "log": result.stdout[-3000:],
        })
    except subprocess.TimeoutExpired:
        return jsonify({"ok": False, "error": "Processing timed out (>600s). Try again."}), 500
