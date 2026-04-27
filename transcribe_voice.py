#!/usr/bin/env python
"""Transcribe latest voice from /g/Claude/carousels/voice/ via faster-whisper."""
import sys
import os
from pathlib import Path

# Force cwd to escape G:/Claude/numpy shadow
os.chdir(os.path.dirname(__file__) + "/voice")

VOICE_DIR = Path(r"G:\Claude\carousels\voice")
files = sorted(VOICE_DIR.glob("feedback_*.ogg"), key=lambda p: p.stat().st_mtime)
if not files:
    print("NO_VOICE")
    sys.exit(1)

target = sys.argv[1] if len(sys.argv) > 1 else str(files[-1])
print(f"[transcribe] file={target}", flush=True)

from faster_whisper import WhisperModel
print("[transcribe] loading model...", flush=True)
# small — швидко на CPU, достатня якість для uk/ru
model = WhisperModel("small", device="cpu", compute_type="int8")
print("[transcribe] running...", flush=True)
segments, info = model.transcribe(target, language=None, beam_size=5)
print(f"[transcribe] detected_lang={info.language} prob={info.language_probability:.2f}", flush=True)
out = []
for s in segments:
    line = f"[{s.start:6.1f}s] {s.text.strip()}"
    print(line, flush=True)
    out.append(line)
Path(target.replace(".ogg", ".txt")).write_text("\n".join(out), encoding="utf-8")
print(f"[transcribe] saved → {target.replace('.ogg','.txt')}", flush=True)
