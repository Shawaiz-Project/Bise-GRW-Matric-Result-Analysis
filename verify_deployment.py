from pathlib import Path
import sys

BASE_DIR = Path(__file__).resolve().parent
required = [
    BASE_DIR / "index.html",
    BASE_DIR / "css" / "styles.css",
    BASE_DIR / "js" / "app.js",
    BASE_DIR / "js" / "data-worker.js",
    BASE_DIR / "data" / "MA_2026_results_analysis.xlsx",
]

missing = [path for path in required if not path.exists()]

print(f"Dashboard folder: {BASE_DIR}")
for path in required:
    status = "OK" if path.exists() else "MISSING"
    size = f" ({path.stat().st_size / (1024 * 1024):.2f} MiB)" if path.exists() and path.is_file() else ""
    print(f"[{status}] {path.relative_to(BASE_DIR)}{size}")

if missing:
    print("\nDeployment is not ready. Add the missing files listed above.")
    sys.exit(1)

print("\nDeployment package is ready.")
