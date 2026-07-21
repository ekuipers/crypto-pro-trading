"""
Node port cutover — Gate 3: positions_state.json round-trips losslessly
between the Python and Node engines.

Uses the REAL production load_state()/save_state() (Python) and
loadState()/saveState() (Node) against temp files — only the module-level
_STATE_FILE path is redirected, no logic is reimplemented here. Exercises
both the current real state file and a synthetic state with a fully
populated per-symbol position (the real file currently holds no open
positions, so the nested position schema wouldn't otherwise be touched).

Usage:
    python scripts/verify_state_roundtrip.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import position_state as py_state  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parent.parent
POSITION_STATE_JS = PROJECT_ROOT / "src" / "positionState.js"


def node_load_and_resave(src_path: Path, dst_path: Path) -> None:
    """Round-trip src_path through Node's real loadState()/saveState()."""
    module_url = POSITION_STATE_JS.resolve().as_uri()
    script = (
        f"import {{ loadState, saveState }} from {json.dumps(module_url)};\n"
        f"const state = loadState({json.dumps(str(src_path))});\n"
        f"saveState(state, {json.dumps(str(dst_path))});\n"
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        capture_output=True,
        text=True,
        cwd=PROJECT_ROOT,
    )
    if result.returncode != 0:
        raise RuntimeError(f"node round-trip failed: {result.stderr}")


def check_round_trip(label: str, state: dict) -> bool:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        py_written = tmp_path / "py_written.json"
        node_written = tmp_path / "node_written.json"

        # Python writes (real save_state()) -> Node reads + rewrites (real
        # loadState()/saveState()).
        py_state._STATE_FILE = py_written
        py_state.save_state(state)
        node_load_and_resave(py_written, node_written)
        node_roundtripped = json.loads(node_written.read_text(encoding="utf-8"))

        if node_roundtripped != state:
            print(f"FAIL [{label}]: Python write -> Node read/rewrite changed the state")
            print("expected:", json.dumps(state, indent=2, sort_keys=True))
            print("got:     ", json.dumps(node_roundtripped, indent=2, sort_keys=True))
            return False

        # Node's output -> Python reads it back (real load_state()).
        py_state._STATE_FILE = node_written
        py_reloaded = py_state.load_state()

        if py_reloaded != state:
            print(f"FAIL [{label}]: Node-written state doesn't match original when Python reads it back")
            print("expected:", json.dumps(state, indent=2, sort_keys=True))
            print("got:     ", json.dumps(py_reloaded, indent=2, sort_keys=True))
            return False

    print(f"OK [{label}]: round-trips losslessly Python -> Node -> Python")
    return True


def main() -> int:
    real_state_file = PROJECT_ROOT / "data" / "positions_state.json"
    real_state = json.loads(real_state_file.read_text(encoding="utf-8"))
    for k, v in py_state._EMPTY_STATE.items():
        real_state.setdefault(k, v)

    synthetic_state = dict(real_state)
    synthetic_state["positions"] = {
        "BTC/USD": {
            "entry_price": 61234.5,
            "entry_time_iso": "2026-07-20T12:00:00+00:00",
            "high_water_mark": 63000.0,
            "trailing_stop_active": True,
            "partial_tp_done": True,
            "breakeven_stop": 61500.0,
            "pyramid_tranches": 1,
            "stop_order_id": "abc-123",
            "stop_order_placed_iso": "2026-07-21T09:00:00+00:00",
            "stop_order_limit_price": 60900.25,
            "stop_order_cycles": 3,
        }
    }

    ok = True
    ok &= check_round_trip("real committed state (no open positions)", real_state)
    ok &= check_round_trip("synthetic state (fully populated position)", synthetic_state)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
