"""
Node port cutover — Gate 2: diff one shadow-run cycle's Python vs Node
decision output and emit a single compact JSON line (for append to
data/shadow_run_log.jsonl).

Consumes the JSON files produced by verify_decision_parity.py and
verify_decision_parity.mjs, run back-to-back against the same live
account/market state. Not a live-API call itself — pure comparison.

Usage:
    python scripts/shadow_run_diff.py <py_parity.json> <node_parity.json>
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

FIELD_MAP = {
    "action": "action",
    "score": "score",
    "rsi": "rsi",
    "ema_cross": "emaCross",
    "adx": "adx",
    "obv_trend": "obvTrend",
    "daily_regime": "dailyRegime",
    "regime_4h": "regime4h",
    "bb_trend": "bbTrend",
    "bb_squeeze": "bbSqueeze",
}


def main() -> int:
    if len(sys.argv) != 3:
        sys.stderr.write("usage: shadow_run_diff.py <py_parity.json> <node_parity.json>\n")
        return 2

    py = json.load(open(sys.argv[1], encoding="utf-8"))
    node = json.load(open(sys.argv[2], encoding="utf-8"))

    py_keys = set(py.keys())
    node_keys = set(node.keys())
    symbol_set_mismatch = sorted(py_keys ^ node_keys)

    mismatches = []
    for sym in sorted(py_keys & node_keys):
        p, n = py[sym], node[sym]
        fields = {}
        for pk, nk in FIELD_MAP.items():
            pv, nv = p.get(pk), n.get(nk)
            if isinstance(pv, float) and isinstance(nv, (int, float)):
                if abs(pv - nv) > 1e-6:
                    fields[pk] = {"py": pv, "node": nv}
            elif pv != nv:
                fields[pk] = {"py": pv, "node": nv}
        if fields:
            mismatches.append({"symbol": sym, "fields": fields})

    summary = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "symbols_compared": len(py_keys & node_keys),
        "symbol_set_mismatch": symbol_set_mismatch,
        "mismatch_count": len(mismatches),
        "mismatches": mismatches,
    }
    print(json.dumps(summary, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
