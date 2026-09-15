from pathlib import Path
import sqlite3
import sys

BASE_DIR = Path(__file__).resolve().parent
required = [
    BASE_DIR / "index.html",
    BASE_DIR / "css" / "styles.css",
    BASE_DIR / "js" / "app.js",
    BASE_DIR / "admin" / "index.html",
    BASE_DIR / "backend" / "app.py",
    BASE_DIR / "backend" / "database.py",
    BASE_DIR / "backend" / "routes" / "api.py",
    BASE_DIR / "backend" / "routes" / "admin.py",
    BASE_DIR / "data" / "results.db",
    BASE_DIR / "wsgi.py",
    BASE_DIR / "requirements.txt",
]

missing = [path for path in required if not path.exists()]

print(f"Deployment Root: {BASE_DIR}")
for path in required:
    status = "OK" if path.exists() else "MISSING"
    size = f" ({path.stat().st_size / (1024 * 1024):.2f} MiB)" if path.exists() and path.is_file() else ""
    print(f"[{status}] {path.relative_to(BASE_DIR)}{size}")

if missing:
    print("\nDeployment is not ready. Add the missing files listed above.")
    sys.exit(1)

# Check database sanity
try:
    con = sqlite3.connect(BASE_DIR / "data" / "results.db")
    count = con.execute("SELECT count(*) FROM students").fetchone()[0]
    print(f"\n[OK] Database active: {count:,} students registered in SQLite.")
    con.close()
except Exception as e:
    print(f"\n[ERROR] Database check failed: {e}")
    sys.exit(1)

print("\nProduction deployment package is 100% ready for PythonAnywhere!")
