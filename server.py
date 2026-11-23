"""Run the Codespaces intake and private inbox on separate forwarded ports."""
import json
import os
import re
import sqlite3
import time
import uuid
from contextlib import closing
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get("BOARD_DATABASE", ROOT / ".data" / "board.sqlite3"))
CATEGORIES = {"general", "design", "dev", "content"}
LIMITS = {"title": 140, "brief": 5000, "outcome": 3000, "email": 254}
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/board.js": ("board.js", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/assets/oswald.ttf": ("assets/oswald.ttf", "font/ttf"),
    "/assets/caveat.ttf": ("assets/caveat.ttf", "font/ttf"),
    "/assets/grain.png": ("assets/grain.png", "image/png"),
}


def initialize():
    DATABASE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with closing(sqlite3.connect(DATABASE)) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("""CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, brief TEXT NOT NULL,
            outcome TEXT NOT NULL, email TEXT NOT NULL, category TEXT NOT NULL,
            created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new'
        )""")
        db.commit()


class Board(BaseHTTPRequestHandler):
    def __init__(self, *args, inbox=False, invite_url="/#new", **kwargs):
        self.inbox = inbox
        self.invite_url = invite_url
        super().__init__(*args, **kwargs)

    def send(self, status, mime, data):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def json(self, status, obj):
        self.send(status, "application/json; charset=utf-8", json.dumps(obj, ensure_ascii=False).encode())

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/board-config.js":
            cfg = {"mode": "inbox" if self.inbox else "intake", "invite": self.invite_url}
            self.send(200, "text/javascript; charset=utf-8", ("window.boardConfig=" + json.dumps(cfg)).encode())
        elif path == "/api/tasks" and self.inbox:
            try:
                with closing(sqlite3.connect(DATABASE)) as db:
                    db.row_factory = sqlite3.Row
                    tasks = db.execute("SELECT * FROM tasks ORDER BY created DESC, id")
                    self.json(200, [dict(t) for t in tasks])
            except sqlite3.Error:
                self.json(503, {"error": "Не удалось загрузить доску."})
        elif path in ASSETS:
            filename, mime = ASSETS[path]
            self.send(200, mime, (ROOT / filename).read_bytes())
        else:
            self.json(404, {"error": "Страница не найдена."})

    def do_POST(self):
        if urlsplit(self.path).path != "/api/tasks" or self.inbox:
            return self.json(404, {"error": "Страница не найдена."})
        if self.headers.get_content_type() != "application/json":
            return self.json(415, {"error": "Ожидаются данные формы."})
        try:
            length = int(self.headers["Content-Length"])
            if length <= 0 or length > 65536:
                return self.json(413, {"error": "Сократите текст заявки."})
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError
            if not isinstance(data.get("id"), str):
                raise ValueError
            request_id = str(uuid.UUID(data["id"]))
            fields = {}
            for name, limit in LIMITS.items():
                value = data[name]
                if not isinstance(value, str) or not 0 < len(value.strip()) <= limit:
                    raise ValueError
                value.encode("utf-8")
                fields[name] = value.strip()
            if data["category"] not in CATEGORIES or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", fields["email"]):
                raise ValueError
        except (ValueError, KeyError, TypeError, UnicodeError):
            return self.json(400, {"error": "Проверьте поля и адрес почты."})
        try:
            with closing(sqlite3.connect(DATABASE)) as db, db:
                db.row_factory = sqlite3.Row
                values = dict(fields, id=request_id, category=data["category"], created=int(time.time() * 1000))
                db.execute("""INSERT INTO tasks (id,title,brief,outcome,email,category,created)
                    VALUES (:id,:title,:brief,:outcome,:email,:category,:created)
                    ON CONFLICT(id) DO NOTHING""", values)
                row = db.execute("SELECT * FROM tasks WHERE id=?", (request_id,)).fetchone()
                if any(row[key] != values[key] for key in (*LIMITS, "category")):
                    return self.json(409, {"error": "Обновите страницу и повторите отправку."})
                result = dict(row)
            self.json(200, result)
        except sqlite3.Error:
            self.json(503, {"error": "Не удалось сохранить заявку. Попробуйте ещё раз."})


if __name__ == "__main__":
    initialize()
    host = os.environ.get("CODESPACE_NAME")
    domain = os.environ.get("GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN", "app.github.dev")
    public_port = int(os.environ.get("BOARD_FORM_PORT", 8001))
    private_port = int(os.environ.get("BOARD_INBOX_PORT", 8000))
    form = (f"https://{host}-{public_port}.{domain}" if host else f"http://localhost:{public_port}") + "/#new"
    public = ThreadingHTTPServer(("127.0.0.1", public_port), partial(Board, invite_url=form))
    private = ThreadingHTTPServer(("127.0.0.1", private_port), partial(Board, inbox=True, invite_url=form))
    Thread(target=public.serve_forever, daemon=True).start()
    private.serve_forever()
