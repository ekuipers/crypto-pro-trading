# scripts/_env.py
"""
Tiny zero-dependency .env loader. Looks for a `.env` file at the project
root (one level up from this scripts/ directory) and pushes any KEY=VALUE
lines into os.environ. Strips surrounding whitespace and CR characters
so Windows-style line endings don't sneak into HTTP headers.

Existing environment variables always win over .env values, so the file
is a default, not an override.
"""

from __future__ import annotations
import os
from pathlib import Path


def load_env() -> None:
    project_root = Path(__file__).resolve().parent.parent
    env_path = project_root / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip().lstrip("﻿")  # tolerate UTF-8 BOM
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("'").strip('"').rstrip("\r")
        if key and key not in os.environ:
            os.environ[key] = value


# Auto-load on import. Importing _env at the top of any script is enough.
load_env()
