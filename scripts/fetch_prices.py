"""Fetch daily closes, dividends and splits from Yahoo Finance and freeze them into
prices/<SYMBOL>.json.

Run from the repo root:  python scripts/fetch_prices.py

- Reads every opening post under src/content/theses/ to find the symbols and the
  earliest entry date needed for each.
- Saves the raw close (not adjusted close): adjusted closes are rewritten by Yahoo
  after every dividend or split, which would silently change published numbers.
  Dividends and splits are saved as events instead, and the site computes total
  return from closes + dividends itself.
- Append-only: a value already in a snapshot is never overwritten. If Yahoo later
  reports something different for that date, the old value is kept and a warning printed.
"""

from __future__ import annotations

import datetime as dt
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
THESES = ROOT / "src" / "content" / "theses"
PRICES = ROOT / "prices"
SOURCE = (
    "Yahoo Finance chart API v8: daily raw close (not dividend-adjusted), "
    "dividends per share by ex-date, splits as new shares per old share"
)
LOOKBACK_DAYS = 10  # fetch a little before entry_date so the entry close is always covered
SERIES = ("closes", "dividends", "splits")


def front_matter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return {}
    return yaml.safe_load(text.split("---", 2)[1]) or {}


def as_date(value) -> dt.date:
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    return dt.date.fromisoformat(str(value))


def symbols_needed() -> dict[str, dt.date]:
    """Map each symbol to the earliest date we need data from."""
    needed: dict[str, dt.date] = {}
    for path in sorted(THESES.glob("*/*-open.md")):
        fm = front_matter(path)
        start = as_date(fm["entry_date"]) - dt.timedelta(days=LOOKBACK_DAYS)
        for leg in (fm.get("long") or []) + (fm.get("short") or []):
            symbol = leg if isinstance(leg, str) else leg["symbol"]
            needed[symbol] = min(start, needed.get(symbol, start))
    return needed


def fetch(symbol: str, start: dt.date) -> dict:
    period1 = int(dt.datetime.combine(start, dt.time(), dt.timezone.utc).timestamp())
    period2 = int(time.time()) + 86400
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        f"{urllib.parse.quote(symbol)}?period1={period1}&period2={period2}"
        "&interval=1d&events=div%7Csplit"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.load(resp)["chart"]["result"][0]

    meta = result["meta"]
    offset = dt.timedelta(seconds=meta.get("gmtoffset", 0))

    def local_date(ts: int) -> str:
        return ((dt.datetime.fromtimestamp(ts, dt.timezone.utc) + offset).date()).isoformat()

    # Skip today's bar while the market may still be open; it isn't a close yet.
    session_end = meta.get("currentTradingPeriod", {}).get("regular", {}).get("end")
    today = local_date(int(time.time()))

    closes: dict[str, float] = {}
    for ts, close in zip(result.get("timestamp", []), result["indicators"]["quote"][0]["close"]):
        if close is None:
            continue
        day = local_date(ts)
        if day >= today and session_end and time.time() < session_end:
            continue
        closes[day] = round(float(close), 6)

    events = result.get("events", {})
    dividends = {local_date(int(ts)): round(float(e["amount"]), 6) for ts, e in events.get("dividends", {}).items()}
    splits = {
        local_date(int(ts)): round(float(e["numerator"]) / float(e["denominator"]), 6)
        for ts, e in events.get("splits", {}).items()
    }
    return {
        "currency": meta.get("currency"),
        "timezone": meta.get("exchangeTimezoneName"),
        "closes": closes,
        "dividends": dividends,
        "splits": splits,
    }


def check_dividends(symbol: str, snapshot: dict) -> None:
    """Warn if a dividend looks like it's in a different unit from the price (e.g. GBP vs GBp)."""
    closes = snapshot["closes"]
    for day, amount in snapshot["dividends"].items():
        before = [d for d in closes if d <= day]
        if not before:
            continue
        ratio = amount / closes[max(before)]
        if ratio > 0.25 or ratio < 0.0005:
            print(
                f"  WARNING {symbol} dividend {amount} on {day} is {ratio:.4%} of the close "
                f"({snapshot.get('currency')}) - check the unit"
            )


def merge(symbol: str, fetched: dict) -> dict[str, int]:
    path = PRICES / f"{symbol}.json"
    if path.exists():
        snapshot = json.loads(path.read_text(encoding="utf-8"))
    else:
        snapshot = {"symbol": symbol, "source": SOURCE}
    snapshot["source"] = SOURCE
    snapshot["currency"] = fetched["currency"]
    snapshot["timezone"] = fetched["timezone"]

    added = {}
    for series in SERIES:
        frozen = snapshot.setdefault(series, {})
        added[series] = 0
        for day, value in fetched[series].items():
            old = frozen.get(day)
            if old is None:
                frozen[day] = value
                added[series] += 1
            elif abs(old - value) > 1e-6 * max(1.0, abs(old)):
                print(f"  WARNING {symbol} {series} {day}: kept frozen {old}, Yahoo now says {value}")
        snapshot[series] = dict(sorted(frozen.items()))

    check_dividends(symbol, snapshot)
    ordered = {k: snapshot[k] for k in ("symbol", "source", "currency", "timezone", *SERIES)}
    path.write_text(json.dumps(ordered, indent=2) + "\n", encoding="utf-8", newline="\n")
    return added


def main() -> int:
    PRICES.mkdir(exist_ok=True)
    needed = symbols_needed()
    if not needed:
        print("No theses found.")
        return 0
    failures = 0
    for symbol, start in sorted(needed.items()):
        try:
            added = merge(symbol, fetch(symbol, start))
            print(
                f"{symbol}: +{added['closes']} closes, +{added['dividends']} dividends, "
                f"+{added['splits']} splits (from {start})"
            )
        except Exception as exc:  # keep going; report at the end
            failures += 1
            print(f"{symbol}: FAILED - {exc}")
        time.sleep(0.5)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
