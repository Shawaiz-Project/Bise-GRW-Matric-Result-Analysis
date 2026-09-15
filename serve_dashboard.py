#!/usr/bin/env python3
"""Serve the result dashboard and API on a local server."""

from __future__ import annotations

import argparse
import os
import threading
import webbrowser
from pathlib import Path

from backend.app import create_app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the SSC result dashboard locally.")
    parser.add_argument("--host", default="127.0.0.1", help="Host address. Default: 127.0.0.1")
    parser.add_argument("--port", type=int, default=5000, help="Port number. Default: 5000")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the browser automatically")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    project_directory = Path(__file__).resolve().parent
    app = create_app()

    url_host = "localhost" if args.host in {"127.0.0.1", "0.0.0.0"} else args.host
    url = f"http://{url_host}:{args.port}"
    print(f"Serving dashboard from: {project_directory}")
    print(f"Open: {url}")
    print("Press Ctrl+C to stop.")

    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()

