#!/usr/bin/env python
"""
tg_listener.py — слухає @emeli_admin_bot, ловить нові повідомлення від Юрія,
друкує на stdout (Monitor підхоплює як notification) і зберігає у JSONL.

Використовуй:
  PYTHONIOENCODING=utf-8 /c/Python314/python.exe -u tg_listener.py

Файли:
  tg_inbox.jsonl  — кожен рядок = JSON одного повідомлення Юрія
  tg_offset.txt   — last update_id (щоб не дублювати при рестарті)
"""

import json
import time
import sys
import urllib.request
import urllib.error
from pathlib import Path

BOT = "REDACTED_BOT_TOKEN"
ALLOWED_CHAT = 719023789  # Юрій
API = f"https://api.telegram.org/bot{BOT}"
ROOT = Path(__file__).parent
INBOX = ROOT / "tg_inbox.jsonl"
OFFSET_FILE = ROOT / "tg_offset.txt"


def get(path: str, **params) -> dict:
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"{API}/{path}" + (f"?{qs}" if qs else "")
    try:
        with urllib.request.urlopen(url, timeout=40) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.URLError as e:
        return {"ok": False, "err": f"net:{e}"}
    except Exception as e:
        return {"ok": False, "err": str(e)}


def load_offset() -> int:
    if OFFSET_FILE.exists():
        try:
            return int(OFFSET_FILE.read_text().strip())
        except (ValueError, OSError):
            return 0
    return 0


def save_offset(o: int) -> None:
    OFFSET_FILE.write_text(str(o))


def main():
    offset = load_offset()
    print(f"[tg_listener] STARTED · offset={offset} · chat={ALLOWED_CHAT}", flush=True)

    while True:
        res = get("getUpdates", offset=offset, timeout=30)
        if not res.get("ok"):
            print(f"[tg_listener] poll error: {res.get('err','?')}", flush=True)
            time.sleep(8)
            continue

        for upd in res.get("result", []):
            offset = upd["update_id"] + 1
            save_offset(offset)

            msg = upd.get("message") or upd.get("edited_message") or {}
            chat_id = (msg.get("chat") or {}).get("id")
            if chat_id != ALLOWED_CHAT:
                continue

            text = msg.get("text") or msg.get("caption") or ""
            voice = msg.get("voice")
            audio = msg.get("audio")
            video_note = msg.get("video_note")
            photo = msg.get("photo")
            document = msg.get("document")

            kind = "text"
            if voice:
                kind = f"voice({voice.get('duration','?')}s)"
                text = text or "<voice>"
            elif video_note:
                kind = f"video_note({video_note.get('duration','?')}s)"
                text = text or "<video_note>"
            elif audio:
                kind = "audio"
                text = text or "<audio>"
            elif photo:
                kind = "photo"
                text = text or "<photo>"
            elif document:
                kind = "document"
                text = text or f"<document:{document.get('file_name','?')}>"

            if not text.strip():
                text = "<empty>"

            from_name = (msg.get("from") or {}).get("first_name", "?")
            entry = {
                "ts": msg.get("date"),
                "update_id": upd["update_id"],
                "from": from_name,
                "kind": kind,
                "text": text,
                "file_id": (voice or video_note or audio or document or {}).get("file_id"),
            }
            with INBOX.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")

            # Single line per message — Monitor sees this as one notification
            print(f"[TG_MSG/{kind}] {from_name}: {text}", flush=True)

        # If long-poll returned (no updates within timeout) — short pause
        time.sleep(2)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("[tg_listener] stopped by user", flush=True)
        sys.exit(0)
