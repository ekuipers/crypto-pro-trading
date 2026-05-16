# tests/conftest.py
"""
Shared pytest configuration.

- Adds scripts/ to sys.path so tests can import indicators, risk, etc.
- Sets dummy environment variables so _env.py / trade.py don't crash when
  they're imported (tests never hit the real Alpaca API).
"""
import os
import sys
from pathlib import Path

# Make `import indicators`, `import risk`, etc. work from the tests/ directory.
SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

# Provide fake Alpaca credentials so _env.py doesn't leave empty strings.
os.environ.setdefault("APCA_API_KEY_ID",     "TEST_KEY")
os.environ.setdefault("APCA_API_SECRET_KEY", "TEST_SECRET")
os.environ.setdefault("APCA_BASE_URL",       "https://paper-api.alpaca.markets")
