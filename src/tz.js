// src/tz.js
//
// Europe/Amsterdam wall-clock formatting for journal timestamps -- the one
// place this project converts a UTC instant into local date/time strings.
// Mirrors scripts/run_evaluation.py's
// `datetime.now(ZoneInfo("Europe/Amsterdam"))` + strftime("%Y-%m-%d"/"%H:%M").
//
// Journal headers use a hardcoded "GMT+2" label regardless of the actual
// DST offset (Amsterdam is UTC+1/CET in winter, UTC+2/CEST in summer) -- an
// existing convention in the Python engine and the rest of this project
// (see CLAUDE.md, "all times GMT+2"), preserved here rather than "fixed" so
// the two engines and the docs stay in lockstep.
//
// Use amsterdamParts() only for journal filenames/headers. Everything else
// that needs a timestamp (last_evaluation_iso, the 90-minute cadence-gap
// check, position_state.json) uses plain UTC `Date`/`.toISOString()` -- keep
// the two clocks separate, never collapse them into one.

const TZ = "Europe/Amsterdam";

const PARTS_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Amsterdam wall-clock date ("YYYY-MM-DD") and time ("HH:MM") for the given
 * instant (default now).
 */
export function amsterdamParts(date = new Date()) {
  const parts = Object.fromEntries(PARTS_FMT.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    timeStr: `${parts.hour}:${parts.minute}`,
  };
}
