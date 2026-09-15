#!/usr/bin/env python3
"""Serve the result dashboard on a local HTTP server."""

from __future__ import annotations

import argparse
import functools
import http.server
import socketserver
import threading
import webbrowser
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the SSC result dashboard locally.")
    parser.add_argument("--host", default="127.0.0.1", help="Host address. Default: 127.0.0.1")
    parser.add_argument("--port", type=int, default=8000, help="Port number. Default: 8000")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the browser automatically")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    project_directory = Path(__file__).resolve().parent
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(project_directory))

    with socketserver.ThreadingTCPServer((args.host, args.port), handler) as server:
        server.daemon_threads = True
        url_host = "localhost" if args.host in {"127.0.0.1", "0.0.0.0"} else args.host
        url = f"http://{url_host}:{args.port}"
        print(f"Serving dashboard from: {project_directory}")
        print(f"Open: {url}")
        print("Press Ctrl+C to stop.")

        if not args.no_browser:
            threading.Timer(0.7, lambda: webbrowser.open(url)).start()

        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")


if __name__ == "__main__":
    main()
