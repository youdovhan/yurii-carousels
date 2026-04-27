#!/usr/bin/env python
"""
preview_carousel.py — надсилає 10 JPEG карусель у @emeli_admin_bot
для approve перед публікацією.

Usage:
  python preview_carousel.py <variant>/<slug> [<slug2> ...]
  python preview_carousel.py harmony/dzerkalo hormozi/analiz hormozi/produkt hormozi/anketa

Бот: @emeli_admin_bot · chat: Юрій (719023789)
"""

import sys
import os
import json
import urllib.request
import urllib.parse
from pathlib import Path

BOT_TOKEN = "REDACTED_BOT_TOKEN"
CHAT_ID = "719023789"
API = f"https://api.telegram.org/bot{BOT_TOKEN}"
ROOT = Path(__file__).parent


def http_post(path: str, data: dict, files: dict | None = None) -> dict:
    """Multipart POST для файлів, JSON для простих."""
    url = f"{API}/{path}"
    if files:
        # multipart/form-data
        boundary = "----CarouselPreviewBoundary"
        body_parts: list[bytes] = []
        for k, v in data.items():
            body_parts.append(f"--{boundary}\r\n".encode())
            body_parts.append(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode())
            body_parts.append(str(v).encode("utf-8"))
            body_parts.append(b"\r\n")
        for k, (filename, content, content_type) in files.items():
            body_parts.append(f"--{boundary}\r\n".encode())
            body_parts.append(
                f'Content-Disposition: form-data; name="{k}"; filename="{filename}"\r\n'.encode()
            )
            body_parts.append(f"Content-Type: {content_type}\r\n\r\n".encode())
            body_parts.append(content)
            body_parts.append(b"\r\n")
        body_parts.append(f"--{boundary}--\r\n".encode())
        body = b"".join(body_parts)
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
    else:
        body = json.dumps(data).encode("utf-8")
        req = urllib.request.Request(
            url, data=body, headers={"Content-Type": "application/json"}
        )

    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": e.read().decode("utf-8", errors="replace")}


def send_text(text: str) -> dict:
    return http_post(
        "sendMessage",
        {"chat_id": CHAT_ID, "text": text, "parse_mode": "HTML"},
    )


def send_carousel(slug: str) -> bool:
    """Надсилає 10 JPEG як media group + caption з кнопками-інструкціями."""
    folder = ROOT / slug
    if not folder.exists():
        print(f"  [SKIP] folder not found: {folder}")
        return False

    jpegs = sorted(folder.glob("slide_??.jpg"))
    if len(jpegs) < 10:
        print(f"  [SKIP] only {len(jpegs)} JPEG in {folder} (need 10)")
        return False

    # Caption from text_v2.md (first H1 / title)
    text_file = folder / "text_v2.md"
    title = slug
    if text_file.exists():
        for line in text_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("# "):
                title = line.lstrip("# ").strip()
                break

    # Build media group: 10 attached files referenced by attach://
    media = []
    files = {}
    for i, jpeg in enumerate(jpegs[:10], 1):
        attach_name = f"slide_{i:02d}"
        media.append(
            {
                "type": "photo",
                "media": f"attach://{attach_name}",
                **({"caption": f"<b>{title}</b>\n<code>{slug}</code>", "parse_mode": "HTML"} if i == 1 else {}),
            }
        )
        files[attach_name] = (
            jpeg.name,
            jpeg.read_bytes(),
            "image/jpeg",
        )

    print(f"  -> sending {slug} (10 JPEG, {sum(len(b[1]) for b in files.values()) // 1024}KB)...")
    res = http_post(
        "sendMediaGroup",
        {"chat_id": CHAT_ID, "media": json.dumps(media, ensure_ascii=False)},
        files=files,
    )
    if not res.get("ok"):
        print(f"  [FAIL] {res}")
        return False
    print(f"  [OK] sent {slug}")
    return True


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    slugs = sys.argv[1:]
    print(f"Previewing {len(slugs)} carousels to @emeli_admin_bot (chat {CHAT_ID})...\n")

    # Header message
    send_text(
        f"📸 <b>Carousel preview ({len(slugs)})</b>\n\n"
        f"Перерендерено зі світлим дизайном (без темних слайдів).\n\n"
        f"Дивись 10 слайдів кожної. Якщо ОК — у Notion постав <b>Approved</b>.\n"
        f"Якщо правки — пиши тут текстом, я обробляю в наступну сесію."
    )

    ok_count = 0
    for slug in slugs:
        if send_carousel(slug):
            ok_count += 1

    send_text(
        f"✅ Надіслано {ok_count}/{len(slugs)}.\n\n"
        f"Очікую твоє рішення (ok / правки)."
    )
    print(f"\nDone: {ok_count}/{len(slugs)}")


if __name__ == "__main__":
    main()
