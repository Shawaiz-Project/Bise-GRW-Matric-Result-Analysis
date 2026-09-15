# PythonAnywhere Production Deployment Guide

This platform is powered by a high-performance Flask REST API and an indexed SQLite database (`data/results.db`). Users no longer download the 41 MB Excel file — pages and searches load instantly (<200ms).

---

## 1. Project Directory Structure

```text
/home/YOUR_USERNAME/matrixresult/
├── backend/
│   ├── app.py              # Flask app factory
│   ├── database.py         # SQLite connection & schema
│   ├── analytics.py        # Insight generation engine
│   ├── process_data.py     # ETL script (Excel → SQLite)
│   └── routes/
│       ├── api.py          # REST endpoints
│       └── admin.py        # Admin panel & upload routes
├── admin/
│   └── index.html          # Protected admin panel
├── css/
│   └── styles.css          # Modern stylesheet
├── js/
│   └── app.js              # API-driven SPA client
├── data/
│   ├── results.db          # Precomputed SQLite database
│   └── MA_2026_results_analysis.xlsx  # Source Excel (optional after ETL)
├── index.html              # Main dashboard frontend
├── wsgi.py                 # PythonAnywhere WSGI entry point
└── requirements.txt        # Python dependencies
```

---

## 2. Deploying on PythonAnywhere

### Step A: Clone or Upload Repository
Open a Bash console in PythonAnywhere:
```bash
cd ~
git clone https://github.com/Shawaiz-Project/Bise-GRW-Matric-Result-Analysis.git matrixresult
cd matrixresult
```

### Step B: Install Python Dependencies
```bash
pip install --user -r requirements.txt
```

### Step C: Ensure Database is Ready
If `data/results.db` is already present in your repo, verify it:
```bash
python -c "import sqlite3; con=sqlite3.connect('data/results.db'); print('Total students:', con.execute('SELECT count(*) FROM students').fetchone()[0])"
```

If you ever need to rebuild or update from a new Excel file:
```bash
python backend/process_data.py --year 2026 --exam-type Annual
```

### Step D: Configure the Web App
1. Go to the **Web** tab on PythonAnywhere (`https://www.pythonanywhere.com/user/YOUR_USERNAME/webapps/`).
2. If you don't have a web app yet, click **Add a new web app** -> **Manual Configuration** -> Select **Python 3.10** (or 3.11/3.12).
3. Under **Code**:
   - **Source code**: `/home/YOUR_USERNAME/matrixresult`
   - **Working directory**: `/home/YOUR_USERNAME/matrixresult`
   - **WSGI configuration file**: Click the link to edit the WSGI file.
4. Replace the entire content of the WSGI file with:
```python
import sys
import os
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path('/home/YOUR_USERNAME/matrixresult')
sys.path.insert(0, str(PROJECT_ROOT))

from backend.app import create_app
application = create_app()
```
*(Replace `YOUR_USERNAME` with your actual PythonAnywhere username)*.
5. Save the WSGI file.
6. Click the green **Reload YOUR_USERNAME.pythonanywhere.com** button.

---

## 3. Environment Variables (Optional)

Create a `.env` file in the project root if you want custom settings:
```ini
ADMIN_PASSWORD=your_secure_password
SITE_URL=https://matrixresult.pythonanywhere.com
```

---

## 4. Admin Panel Access

Open `https://YOUR_USERNAME.pythonanywhere.com/admin`
- Default password: `admin2026` (or the value set in `ADMIN_PASSWORD`)
- Upload future exam workbooks (.xlsx) directly through the admin panel without manual SSH.
