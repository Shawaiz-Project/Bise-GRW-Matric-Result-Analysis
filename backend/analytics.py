"""
analytics.py — Dynamic insight engine.

Reads from the analytics_cache and student tables to generate
meaningful, data-driven insights.  No hardcoded statements.
"""

from __future__ import annotations

import json
from typing import Any

from backend.database import get_db


def _cache(conn, dataset_id: int, key: str) -> Any | None:
    """Fetch a cached analytics value by key."""
    row = conn.execute(
        "SELECT value_json FROM analytics_cache WHERE dataset_id=? AND cache_key=?",
        (dataset_id, key),
    ).fetchone()
    return json.loads(row["value_json"]) if row else None


def generate_insights(dataset_id: int) -> list[dict]:
    """Return a list of insight dicts with 'title' and 'text' keys."""
    insights: list[dict] = []

    with get_db() as conn:
        summary = _cache(conn, dataset_id, "summary") or {}
        subjects = _cache(conn, dataset_id, "subject_failures") or []
        institutions = _cache(conn, dataset_id, "institutions") or []
        top_students = _cache(conn, dataset_id, "top_students") or []
        quality = _cache(conn, dataset_id, "data_quality") or []

        # ── 1. Overall pass performance ──────────────────────────────────
        passed = summary.get("passed", 0)
        appeared = summary.get("appeared", 0)
        pass_pct = summary.get("pass_percentage")
        if appeared:
            insights.append({
                "title": "Overall pass performance",
                "text": (
                    f"{passed:,} of {appeared:,} appeared candidates passed, "
                    f"achieving a {pass_pct:.2f}% pass rate."
                ),
                "type": "info",
            })

        # ── 2. Students needing another attempt ──────────────────────────
        not_passed = summary.get("not_passed", 0)
        fail_slip = summary.get("fail_slip", 0)
        if appeared:
            insights.append({
                "title": "Students needing another attempt",
                "text": (
                    f"{not_passed:,} appeared candidates did not pass. "
                    f"{fail_slip:,} were directly classified as Fail/Slip."
                ),
                "type": "warning" if not_passed > passed else "info",
            })

        # ── 3. Highest recorded score ─────────────────────────────────────
        highest = summary.get("highest_marks")
        if top_students and highest:
            top = top_students[0]
            insights.append({
                "title": "Highest recorded score",
                "text": (
                    f"{top.get('name') or 'The leading candidate'} "
                    f"(Roll: {top.get('roll_no', '')}) scored "
                    f"{highest:,} marks — the highest in this dataset."
                ),
                "type": "success",
            })
        elif highest:
            insights.append({
                "title": "Highest recorded score",
                "text": f"The highest numeric result in this dataset is {highest:,} marks.",
                "type": "success",
            })

        # ── 4. Average marks ─────────────────────────────────────────────
        avg_marks = summary.get("average_marks")
        if avg_marks:
            insights.append({
                "title": "Average performance",
                "text": (
                    f"The mean marks among all numeric results is "
                    f"{avg_marks:.1f}. "
                    f"{'Above average performance suggests strong exam preparation.' if avg_marks >= 600 else 'There is room for improvement in average performance across schools.'}"
                ),
                "type": "info",
            })

        # ── 5. Most common failed subject ─────────────────────────────────
        if subjects:
            top_subj = subjects[0]
            insights.append({
                "title": "Most common failed subject",
                "text": (
                    f"{top_subj.get('subject_name') or top_subj.get('subject_code', 'Unknown')} "
                    f"affected the most students, with "
                    f"{top_subj.get('unique_students', 0):,} unique students "
                    f"across {top_subj.get('total_entries', 0):,} total slip entries."
                ),
                "type": "warning",
            })

        # ── 6. Best school pass rate ──────────────────────────────────────
        eligible = [s for s in institutions if (s.get("candidates") or 0) >= 20]
        if eligible:
            best = max(eligible, key=lambda x: x.get("pass_percentage") or 0)
            insights.append({
                "title": "Best school pass rate",
                "text": (
                    f"{best.get('institution_name', 'A school')} achieved the highest pass rate "
                    f"({best.get('pass_percentage', 0):.2f}%) "
                    f"among schools with at least 20 candidates "
                    f"({best.get('candidates', 0):,} total candidates)."
                ),
                "type": "success",
            })

        # ── 7. Largest institution ────────────────────────────────────────
        if institutions:
            largest = max(institutions, key=lambda x: x.get("candidates") or 0)
            largest_pass = largest.get("pass_percentage")
            insights.append({
                "title": "Largest institution by candidates",
                "text": (
                    f"{largest.get('institution_name', 'The largest school')} has "
                    f"{largest.get('candidates', 0):,} candidates "
                    f"with a {largest_pass:.2f}% pass rate."
                    if largest_pass else
                    f"{largest.get('institution_name', 'The largest school')} has "
                    f"{largest.get('candidates', 0):,} candidates."
                ),
                "type": "info",
            })

        # ── 8. Best average marks (school) ───────────────────────────────
        with_avg = [s for s in eligible if s.get("average_marks") is not None]
        if with_avg:
            best_avg = max(with_avg, key=lambda x: x.get("average_marks") or 0)
            insights.append({
                "title": "Strongest average performance",
                "text": (
                    f"{best_avg.get('institution_name', 'A school')} has the highest "
                    f"average marks ({best_avg.get('average_marks', 0):.1f}) "
                    f"among qualifying institutions."
                ),
                "type": "success",
            })

        # ── 9. Special result cases ───────────────────────────────────────
        absent = summary.get("absent", 0)
        cancelled = summary.get("cancelled", 0)
        if absent or cancelled:
            insights.append({
                "title": "Special result cases",
                "text": (
                    f"{absent:,} absent and {cancelled:,} cancelled "
                    f"records are included in this dataset. "
                    f"These are excluded from the pass-rate calculation."
                ),
                "type": "info",
            })

        # ── 10. Data quality ──────────────────────────────────────────────
        warning_checks = [
            q for q in quality
            if any(w in (q.get("check_name") or "").lower()
                   for w in ("duplicate", "missing", "unknown", "unmapped"))
            and _is_nonzero(q.get("value", "0"))
        ]
        if warning_checks:
            insights.append({
                "title": "Data quality alerts",
                "text": (
                    f"{len(warning_checks)} quality checks contain non-zero "
                    f"anomaly values (missing, duplicate, unknown, or unmapped data). "
                    f"Review the Data Quality page for details."
                ),
                "type": "warning",
            })
        else:
            insights.append({
                "title": "Data quality",
                "text": "No critical data quality anomalies were detected in the main checks.",
                "type": "success",
            })

    return insights


def _is_nonzero(value: str) -> bool:
    """Return True if the string represents a non-zero number."""
    try:
        return float(str(value).replace(",", "")) != 0
    except (ValueError, TypeError):
        return False
