import type { Leg, Performance, Unit } from './scoring';

const base = import.meta.env.BASE_URL;

/** Site-relative URL that respects the GitHub Pages base path. */
export const url = (path = ''): string => `${base}${path.replace(/^\//, '')}`;

export const fmtDate = (d: Date | string): string => (typeof d === 'string' ? d : d.toISOString().slice(0, 10));

/** +1.23% or +15bp, with an explicit sign. */
export function fmtReturn(value: number, unit: Unit): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return unit === 'yield' ? `${sign}${Math.abs(value).toFixed(0)}bp` : `${sign}${Math.abs(value).toFixed(2)}%`;
}

export const fmtLegs = (legs: Leg[], side: Leg['side']): string =>
  legs
    .filter((l) => l.side === side)
    .map((l) => (l.weight === 1 ? l.symbol : `${l.symbol} (${l.weight})`))
    .join(', ');

/** "Hit 2026-11-03", "Hit 2026-11-03 (after horizon)", "Not yet", or "—". */
export function fmtTarget(perf: Performance | undefined): string {
  const t = perf?.target;
  if (!t) return '—';
  if (!t.hitDate) return 'Not yet';
  return t.withinHorizon === false ? `Hit ${t.hitDate} (after horizon)` : `Hit ${t.hitDate}`;
}

export const returnClass = (v: number | undefined): string => (v === undefined ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');
