# BISE Gujranwala SSC Result Intelligence Platform
---

An enterprise-grade, high-performance educational analytics platform for BISE Gujranwala Matriculation (SSC) examination results.

Upgraded from client-side spreadsheet parsing to an **API-driven Flask architecture backed by an indexed SQLite database**, loading 245,750+ student records in under 2 seconds.

---

## Key Features

- **Blazing Fast Performance**: Zero 40MB Excel downloads for users; paginated server-side queries execute in <50ms.
- **Result Overview**: 8 KPI cards, dynamic charts for status, grades, marks ranges, and candidate types.
- **Full-Text Candidate Search**: Search 245,750+ students instantly by roll number, name, school, or subject with real-time filtering and pagination.
- **Enhanced Student Modal**: Board-wide overall rank, school rank, percentile calculation, failed subjects chips, and printable result card.
- **School Rankings**: Composite scoring (50% pass rate + 30% average marks + 20% top candidates) with gold/silver/bronze badges for top institutions.
- **Institution Analytics**: Explore candidate volume, pass rates, and mark distributions across 3,176 schools.
- **Subject Slip Analysis**: Detailed analytics on subject failures and Part-I vs Part-II supplementary slip trends.
- **Dynamic Insights Engine**: Automatically generated findings and school size vs pass rate scatter plots computed directly from database statistics.
- **Data Quality & Validation**: Integrity and reconciliation audits ensuring 100% fidelity against board gazettes.
- **Server-Side CSV Export**: Stream filtered student datasets directly to CSV with no 50k browser memory limits.
- **Admin Control Center**: Upload future examination workbooks (`.xlsx`) via web UI with automatic background ETL processing.
- **SEO & Social Sharing**: Complete meta tags, OpenGraph data, XML sitemap (`/sitemap.xml`), and robots.txt (`/robots.txt`).

---

## Architecture & Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python 3.10+, Flask, SQLite3, pandas, openpyxl |
| **API** | RESTful JSON API with indexing, pagination, and caching |
| **Frontend** | Vanilla JavaScript (ES6+), HTML5 Semantic markup, Vanilla CSS |
| **Data Viz** | Chart.js 4.5.1 with responsive dark/light mode integration |
| **Deployment** | PythonAnywhere WSGI compatible (`wsgi.py`) |

---

## Getting Started

### 1. Installation

```bash
git clone https://github.com/Shawaiz-Project/Bise-GRW-Matric-Result-Analysis.git
cd Bise-GRW-Matric-Result-Analysis
pip install -r requirements.txt
```

### 2. Database ETL (One-Time)

If `data/results.db` is not yet populated:
```bash
python backend/process_data.py --year 2026 --exam-type Annual
```

### 3. Run Locally

```bash
python serve_dashboard.py
```
Open [http://localhost:5000](http://localhost:5000) in your browser.

### 4. Admin Panel

Navigate to [http://localhost:5000/admin](http://localhost:5000/admin)
- Default password: `admin2026` (configurable via `ADMIN_PASSWORD` environment variable)

---

## Testing

Run the automated test suite:
```bash
python -m unittest backend/tests/test_api.py
```

---

## Deployment

Refer to [`PYTHONANYWHERE_DEPLOYMENT.md`](PYTHONANYWHERE_DEPLOYMENT.md) for step-by-step instructions on deploying to PythonAnywhere.
