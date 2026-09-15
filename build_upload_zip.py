from pathlib import Path
import shutil
import sys

BASE_DIR = Path(__file__).resolve().parent
EXCEL_NAME = "MA_2026_results_analysis.xlsx"
TARGET = BASE_DIR / "data" / EXCEL_NAME

if len(sys.argv) > 1:
    source = Path(sys.argv[1]).expanduser().resolve()
    if not source.exists():
        raise FileNotFoundError(source)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, TARGET)
    print(f"Copied workbook to: {TARGET}")

if not TARGET.exists():
    raise FileNotFoundError(
        f"Workbook missing: {TARGET}\n"
        f"Run: python build_upload_zip.py /path/to/{EXCEL_NAME}"
    )

zip_base = BASE_DIR.parent / "SSC_Result_Dashboard_PythonAnywhere_With_Excel"
archive = shutil.make_archive(str(zip_base), "zip", root_dir=BASE_DIR.parent, base_dir=BASE_DIR.name)
print(f"Created: {archive}")
