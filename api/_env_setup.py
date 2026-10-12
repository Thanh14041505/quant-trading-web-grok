"""Must import first in every Python API handler — Vercel FS is read-only except /tmp."""
from __future__ import annotations
import os

os.environ.setdefault("HOME", "/tmp")
os.environ.setdefault("XDG_CACHE_HOME", "/tmp/.cache")
os.environ.setdefault("XDG_CONFIG_HOME", "/tmp/.config")
os.environ.setdefault("TMPDIR", "/tmp")
os.environ.setdefault("TEMP", "/tmp")
os.environ.setdefault("TMP", "/tmp")
for d in ("/tmp/.cache", "/tmp/.config", "/tmp/vnstock"):
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        pass
