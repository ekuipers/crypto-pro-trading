# scripts/_api.py
"""
Shared HTTP helper with exponential-backoff retry for all Alpaca API calls.

Retry policy is loaded from config.json (api.max_retry_attempts and
api.retry_backoff_seconds) at import time. Falls back to 3 attempts / 5 s
if the file is missing.

Retryable errors:
  - HTTP 5xx  (server-side, transient)
  - ConnectionError / Timeout  (network blip)

Not retried:
  - HTTP 4xx  (client error -- bad auth, bad symbol, etc.)

Usage:
    from _api import api_get, api_post, api_delete

    r = api_get(url, headers=headers, params=params, timeout=20)
    payload = r.json()
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import requests


def _load_retry_cfg() -> tuple[int, float]:
    cfg_path = Path(__file__).resolve().parent.parent / "config.json"
    try:
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        api_cfg = cfg.get("api", {})
        return (
            int(api_cfg.get("max_retry_attempts", 3)),
            float(api_cfg.get("retry_backoff_seconds", 5.0)),
        )
    except Exception:
        return 3, 5.0


_MAX_ATTEMPTS, _BACKOFF = _load_retry_cfg()


def _api_request(
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    max_attempts: int = _MAX_ATTEMPTS,
    backoff_seconds: float = _BACKOFF,
    **kwargs: Any,
) -> requests.Response:
    """Make an HTTP request with exponential-backoff retry on transient errors.

    Args:
        method:          HTTP verb ("GET", "POST", "DELETE", …)
        url:             Full URL to call.
        headers:         Request headers dict (required keyword argument).
        max_attempts:    Total tries before giving up (default from config.json).
        backoff_seconds: Base wait between retries; doubled each attempt
                         (5 s → 10 s → 20 s …).
        **kwargs:        Passed straight through to requests.request()
                         (params, json, timeout, etc.).

    Returns:
        requests.Response with a 2xx status code.

    Raises:
        requests.exceptions.HTTPError:        On 4xx (immediate) or 5xx (after retries).
        requests.exceptions.ConnectionError:  After all retries exhausted.
        requests.exceptions.Timeout:          After all retries exhausted.
    """
    last_exc: Exception | None = None
    for attempt in range(max_attempts):
        try:
            r = requests.request(method, url, headers=headers, **kwargs)
            r.raise_for_status()
            return r
        except requests.exceptions.HTTPError as exc:
            # 4xx errors are client mistakes — retrying won't help.
            if exc.response is not None and exc.response.status_code < 500:
                raise
            last_exc = exc
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as exc:
            last_exc = exc

        if attempt < max_attempts - 1:
            wait = backoff_seconds * (2 ** attempt)
            time.sleep(wait)

    # All attempts failed — re-raise the last exception.
    assert last_exc is not None  # guaranteed by loop structure
    raise last_exc


def api_get(url: str, *, headers: dict[str, str], **kwargs: Any) -> requests.Response:
    """GET with retry."""
    return _api_request("GET", url, headers=headers, **kwargs)


def api_post(url: str, *, headers: dict[str, str], **kwargs: Any) -> requests.Response:
    """POST with retry."""
    return _api_request("POST", url, headers=headers, **kwargs)


def api_delete(url: str, *, headers: dict[str, str], **kwargs: Any) -> requests.Response:
    """DELETE with retry."""
    return _api_request("DELETE", url, headers=headers, **kwargs)
