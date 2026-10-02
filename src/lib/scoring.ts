/**
 * Performance maths for a thesis, computed only from frozen price snapshots.
 *
 * - Price theses: each leg's headline move is its total return in % — raw closes
 *   plus dividends reinvested at the ex-date close, adjusted for splits. The
 *   price-only return is computed alongside. Yield theses (e.g. ^TNX, quoted in
 *   percent): each leg's move is the change in basis points; no dividends.
 * - A thesis's return is Σ(sign × weight × leg move) / gross, where gross is the
 *   sum of all weights (long + short). Unweighted legs count as 1. A short pays
 *   the dividends, so they count against it.
 * - Every leg uses its close on or before a given date, so exchange holidays on
 *   one leg don't break a pair.
 */

export type Closes = Record<string, number>; // ISO date → value

export interface Snapshot {
  closes: Closes;
  dividends?: Closes; // ex-date → amount per share, in the price's currency
  splits?: Closes; // date → new shares per old share (2 for a 2-for-1)
}

export type Prices = Record<string, Snapshot | undefined>; // symbol → snapshot

export type Unit = 'price' | 'yield';
export type LegInput = string | { symbol: string; weight: number };

export interface ThesisTerms {
  date: Date; // posting date
  long: LegInput[];
  short: LegInput[];
  entry_date: Date;
  unit: Unit;
  target?: number;
  target_return?: number;
  horizon?: Date;
}

export interface Leg {
  symbol: string;
  side: 'long' | 'short';
  weight: number;
}

export interface Point {
  date: string;
  value: number; // headline: total return % (price theses) or bp (yield theses)
  priceValue: number; // price-only return, excluding dividends
}

export interface LegEntry extends Leg {
  entryDate: string; // actual close date used (on or before entry_date)
  entryClose: number;
  dividends: { date: string; amount: number }[]; // ex-dates after entry, up to the end date
  splits: { date: string; ratio: number }[];
}

export interface Performance {
  unit: Unit;
  legs: LegEntry[];
  /** Calendar days from the entry close to the posting date (positive = entry before posting). */
  entryGapDays: number;
  series: Point[]; // from entry to `end`
  end: Point;
  maxDrawdown: number; // worst peak-to-trough fall in the headline series, ≤ 0
  target?: {
    kind: 'price' | 'return';
    level: number;
    hitDate?: string; // first close at or beyond target after the entry date
    withinHorizon?: boolean;
  };
}

/** Prices aren't available yet (not fetched, or entry before the snapshot). Shown as "pending". */
export class PriceDataError extends Error {}
/** The thesis terms contradict the prices (e.g. target on the wrong side of entry). Fails the build. */
export class TermsError extends Error {}

export const iso = (d: Date): string => d.toISOString().slice(0, 10);

const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function normaliseLegs(terms: Pick<ThesisTerms, 'long' | 'short'>): Leg[] {
  const toLeg = (side: Leg['side']) => (l: LegInput): Leg =>
    typeof l === 'string' ? { symbol: l, side, weight: 1 } : { symbol: l.symbol, side, weight: l.weight };
  return [...terms.long.map(toLeg('long')), ...terms.short.map(toLeg('short'))];
}

/** Latest close on or before `date`, or undefined if none. */
export function closeOnOrBefore(closes: Closes, date: string): { date: string; close: number } | undefined {
  let best: string | undefined;
  for (const d of Object.keys(closes)) {
    if (d <= date && (best === undefined || d > best)) best = d;
  }
  return best === undefined ? undefined : { date: best, close: closes[best] };
}

/** One leg's growth since entry at each of its trading dates. */
interface IndexPoint {
  date: string;
  total: number; // value of 1 unit invested at entry, dividends reinvested
  price: number; // same, excluding dividends
  adjClose: number; // close in entry-date share terms (multiplied by splits since entry)
}

/**
 * Build a leg's growth index from entry. A dividend or split dated on a day with no
 * close (e.g. an ex-date on a holiday) is applied at the next close. A dividend
 * with ex-date on the entry date isn't counted: buying at that close is already ex.
 */
export function legIndex(snap: Snapshot, entryDate: string, endDate: string): IndexPoint[] {
  const dates = Object.keys(snap.closes)
    .filter((d) => d >= entryDate && d <= endDate)
    .sort();
  const events = (series: Closes | undefined, from: string, to: string) =>
    Object.entries(series ?? {}).filter(([d]) => d > from && d <= to);

  const points: IndexPoint[] = [{ date: dates[0], total: 1, price: 1, adjClose: snap.closes[dates[0]] }];
  let splitSinceEntry = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1];
    const d = dates[i];
    const prevClose = snap.closes[prev];
    const close = snap.closes[d];
    const split = events(snap.splits, prev, d).reduce((a, [, r]) => a * r, 1);
    const dividend = events(snap.dividends, prev, d).reduce((a, [, x]) => a + x, 0);
    splitSinceEntry *= split;
    const last = points[i - 1];
    points.push({
      date: d,
      total: last.total * ((split * (close + dividend)) / prevClose),
      price: last.price * ((split * close) / prevClose),
      adjClose: close * splitSinceEntry,
    });
  }
  return points;
}

function pointOnOrBefore<T extends { date: string }>(points: T[], date: string): T | undefined {
  let found: T | undefined;
  for (const p of points) {
    if (p.date > date) break;
    found = p;
  }
  return found;
}

/**
 * Compute performance from entry up to `endDate` (the closing reply's date for a
 * closed thesis, or today for an open one). Throws PriceDataError if prices are
 * missing, TermsError if the terms contradict the prices.
 */
export function computePerformance(terms: ThesisTerms, prices: Prices, endDate: string): Performance {
  const legs = normaliseLegs(terms);
  const gross = legs.reduce((a, l) => a + l.weight, 0);
  const entryIso = iso(terms.entry_date);
  const postIso = iso(terms.date);

  const legData = legs.map((leg) => {
    const snap = prices[leg.symbol];
    if (!snap) throw new PriceDataError(`No price snapshot for ${leg.symbol}. Run scripts/fetch_prices.py.`);
    const entry = closeOnOrBefore(snap.closes, entryIso);
    if (!entry) throw new PriceDataError(`No ${leg.symbol} close on or before entry date ${entryIso}.`);
    const index = legIndex(snap, entry.date, endDate);
    const inWindow = (s: Closes | undefined) =>
      Object.entries(s ?? {})
        .filter(([d]) => d > entry.date && d <= endDate)
        .sort(([a], [b]) => a.localeCompare(b));
    const legEntry: LegEntry = {
      ...leg,
      entryDate: entry.date,
      entryClose: entry.close,
      dividends: terms.unit === 'price' ? inWindow(snap.dividends).map(([date, amount]) => ({ date, amount })) : [],
      splits: inWindow(snap.splits).map(([date, ratio]) => ({ date, ratio })),
    };
    return { leg: legEntry, snap, index };
  });

  const valueAt = (date: string): { value: number; priceValue: number } => {
    let total = 0;
    let price = 0;
    for (const { leg, snap, index } of legData) {
      const sign = leg.side === 'long' ? 1 : -1;
      const p = pointOnOrBefore(index, date)!;
      if (terms.unit === 'yield') {
        const bp = (closeOnOrBefore(snap.closes, date)!.close - leg.entryClose) * 100;
        total += sign * leg.weight * bp;
        price += sign * leg.weight * bp;
      } else {
        total += sign * leg.weight * (p.total - 1) * 100;
        price += sign * leg.weight * (p.price - 1) * 100;
      }
    }
    return { value: total / gross, priceValue: price / gross };
  };

  // Every trading date on any leg between entry and end.
  const firstEntry = legData.map((l) => l.leg.entryDate).sort()[0];
  const dates = new Set<string>();
  for (const { index } of legData) for (const p of index) if (p.date > firstEntry) dates.add(p.date);
  const series: Point[] = [{ date: firstEntry, value: 0, priceValue: 0 }];
  for (const d of [...dates].sort()) series.push({ date: d, ...valueAt(d) });

  let peak = 0;
  let maxDrawdown = 0;
  for (const p of series) {
    peak = Math.max(peak, p.value);
    maxDrawdown = Math.min(maxDrawdown, p.value - peak);
  }

  const perf: Performance = {
    unit: terms.unit,
    legs: legData.map((l) => l.leg),
    entryGapDays: daysBetween(firstEntry, postIso),
    series,
    end: series.at(-1)!,
    maxDrawdown,
  };

  // Target hits count from the entry date. A back-dated entry stays visible via
  // entryGapDays, which the site shows next to the entry point.
  const horizonIso = terms.horizon ? iso(terms.horizon) : undefined;
  if (terms.target !== undefined) {
    // A price level is compared with the split-adjusted close, in entry-date share terms.
    const { leg, index } = legData[0];
    const up = leg.side === 'long';
    if (up ? terms.target <= leg.entryClose : terms.target >= leg.entryClose) {
      throw new TermsError(
        `Target ${terms.target} is on the wrong side of the ${leg.symbol} entry close ${leg.entryClose} for a ${leg.side}.`,
      );
    }
    const hit = index.find(
      (p) => p.date > leg.entryDate && (up ? p.adjClose >= terms.target! : p.adjClose <= terms.target!),
    );
    perf.target = { kind: 'price', level: terms.target, hitDate: hit?.date };
  } else if (terms.target_return !== undefined) {
    // Tolerance so a return of exactly the target (e.g. 9.999999… from float maths) counts.
    const hit = series.find((p) => p.date > firstEntry && p.value >= terms.target_return! - 1e-9);
    perf.target = { kind: 'return', level: terms.target_return, hitDate: hit?.date };
  }
  if (perf.target?.hitDate && horizonIso) perf.target.withinHorizon = perf.target.hitDate <= horizonIso;

  return perf;
}
