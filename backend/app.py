"""
app.py — Flask application factory.

Usage (development):
    python backend/app.py

Usage (production / PythonAnywhere):
    Configure wsgi.py to call create_app().
"""

from __future__ import annotations

import os
from pathlib import Path

from flask import Flask, send_from_directory, jsonify
from flask_cors import CORS

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def create_app() -> Flask:
    app = Flask(
        __name__,
        static_folder=str(PROJECT_ROOT),
        static_url_path="",
    )

    # ── CORS ─────────────────────────────────────────────────────────────
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # ── Register blueprints ───────────────────────────────────────────────
    from backend.routes.api import api_bp
    from backend.routes.admin import admin_bp
    app.register_blueprint(api_bp)
    app.register_blueprint(admin_bp)

    # ── Serve static frontend files ───────────────────────────────────────
    @app.route("/")
    def index():
        return send_from_directory(str(PROJECT_ROOT), "index.html")

    @app.route("/admin")
    def admin_index():
        return send_from_directory(str(PROJECT_ROOT / "admin"), "index.html")

    @app.route("/sitemap.xml")
    def sitemap():
        base = os.environ.get("SITE_URL", "https://matrixresult.pythonanywhere.com")
        xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{base}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
  <url><loc>{base}/#overview</loc><changefreq>monthly</changefreq><priority>0.9</priority></url>
  <url><loc>{base}/#students</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>
  <url><loc>{base}/#schools</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>
  <url><loc>{base}/#subjects</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>{base}/#rankings</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>{base}/#insights</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>
</urlset>"""
        return app.response_class(xml, mimetype="application/xml")

    @app.route("/robots.txt")
    def robots():
        base = os.environ.get("SITE_URL", "https://matrixresult.pythonanywhere.com")
        txt = f"User-agent: *\nAllow: /\nSitemap: {base}/sitemap.xml\n"
        return app.response_class(txt, mimetype="text/plain")

    # ── Global error handlers ─────────────────────────────────────────────
    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"ok": False, "error": "Not found"}), 404

    @app.errorhandler(500)
    def server_error(e):
        return jsonify({"ok": False, "error": "Internal server error"}), 500

    return app


if __name__ == "__main__":
    application = create_app()
    application.run(
        host="127.0.0.1",
        port=int(os.environ.get("PORT", 5000)),
        debug=os.environ.get("FLASK_DEBUG", "1") == "1",
    )
