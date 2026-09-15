"""
wsgi.py — PythonAnywhere WSGI entry point.

In the PythonAnywhere Web tab, set:
  Source code    : /home/YOUR_USERNAME/matrixresult
  Working dir    : /home/YOUR_USERNAME/matrixresult
  WSGI file      : /home/YOUR_USERNAME/matrixresult/wsgi.py
"""

import sys
import os
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

# Optional: load .env file if present
env_file = PROJECT_ROOT / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())

from backend.app import create_app  # noqa: E402
application = create_app()
