import { describe, expect, it } from 'vitest';
import { closeOnOrBefore, computePerformance, TermsError, type Prices, type ThesisTerms } from './scoring';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

// Made-up closes. Oct 3 is a holiday for BBB only.
const prices: Prices = {
  AAA: { closes: { '2026-10-01': 100, '2026-10-02': 105, '2026-10-03': 95, '2026-10-06': 110, '2026-10-07': 120 } },
  BBB: { closes: { '2026-10-01': 50, '2026-10-02': 51, '2026-10-06': 52, '2026-10-07': 54 } },
  YLD: { closes: { '2026-10-01': 4.25, '2026-10-02': 4.1, '2026-10-06': 3.75 } },
  // Pays 2 on Oct 2 (ex-date); the close drops by the dividend.
  DIV: { closes: { '2026-10-01': 100, '2026-10-02': 98, '2026-10-06': 100 }, dividends: { '2026-10-02': 2 } },
  // 2-for-1 split on Oct 2: the raw close halves, nothing is actually lost.
  SPL: { closes: { '2026-10-01': 100, '2026-10-02': 51, '2026-10-06': 60 }, splits: { '2026-10-02': 2 } },
};

const terms = (t: Partial<ThesisTerms>): ThesisTerms => ({
  date: d('2026-10-01'),
  long: [],
  short: [],
  entry_date: d('2026-10-01'),
  unit: 'price',
  ...t,
});

describe('closeOnOrBefore', () => {
  it('uses the exact date when present, else the previous close', () => {
    expect(closeOnOrBefore(prices.BBB!.closes, '2026-10-02')).toEqual({ date: '2026-10-02', close: 51 });
    expect(closeOnOrBefore(prices.BBB!.closes, '2026-10-05')).toEqual({ date: '2026-10-02', close: 51 });
    expect(closeOnOrBefore(prices.BBB!.closes, '2026-09-30')).toBeUndefined();
  });
});

describe('computePerformance', () => {
  it('single long: % return, drawdown, price target hit', () => {
    const p = computePerformance(terms({ long: ['AAA'], target: 110 }), prices, '2026-10-07');
    expect(p.end.date).toBe('2026-10-07');
    expect(p.end.value).toBeCloseTo(20);
    // Peak +5 on Oct 2, trough −5 on Oct 3 → drawdown −10 points.
    expect(p.maxDrawdown).toBeCloseTo(-10);
    expect(p.target).toEqual({ kind: 'price', level: 110, hitDate: '2026-10-06' });
  });

  it('single short: sign flips, target is below entry', () => {
    const p = computePerformance(terms({ short: ['AAA'], target: 96 }), prices, '2026-10-03');
    expect(p.end.value).toBeCloseTo(5); // AAA fell 5%
    expect(p.target?.hitDate).toBe('2026-10-03');
  });

  it('rejects a price target on the wrong side of entry', () => {
    expect(() => computePerformance(terms({ long: ['AAA'], target: 90 }), prices, '2026-10-07')).toThrow(TermsError);
  });

  it('plain pair: (long − short) / gross, using the previous close on a holiday', () => {
    const p = computePerformance(terms({ long: ['AAA'], short: ['BBB'] }), prices, '2026-10-07');
    // AAA +20%, BBB +8% → (20 − 8) / 2 = 6
    expect(p.end.value).toBeCloseTo(6);
    // Oct 3: AAA −5%, BBB still at Oct 2 close (+2%) → (−5 − 2) / 2
    expect(p.series.find((s) => s.date === '2026-10-03')?.value).toBeCloseTo(-3.5);
  });

  it('weighted pair: 100 long vs 50 short over gross 150', () => {
    const p = computePerformance(
      terms({ long: [{ symbol: 'AAA', weight: 100 }], short: [{ symbol: 'BBB', weight: 50 }] }),
      prices,
      '2026-10-07',
    );
    // (100 × 20 − 50 × 8) / 150
    expect(p.end.value).toBeCloseTo(1600 / 150);
  });

  it('yield thesis moves in basis points', () => {
    const p = computePerformance(terms({ short: ['YLD'], unit: 'yield', target_return: 40 }), prices, '2026-10-06');
    expect(p.end.value).toBeCloseTo(50); // 4.25 → 3.75 = −50bp, short → +50
    expect(p.target?.hitDate).toBe('2026-10-06'); // +15bp on Oct 2, +50bp on Oct 6
  });

  it('back-dated entry: gap is reported and pre-posting target hits do not count', () => {
    const p = computePerformance(
      terms({ long: ['AAA'], entry_date: d('2026-10-01'), date: d('2026-10-06'), target_return: 4 }),
      prices,
      '2026-10-07',
    );
    expect(p.entryGapDays).toBe(5);
    // +5% on Oct 2 is before posting, so the first counted hit is Oct 6.
    expect(p.target?.hitDate).toBe('2026-10-06');
  });

  it('entry on a weekend uses the previous close', () => {
    const p = computePerformance(terms({ long: ['BBB'], entry_date: d('2026-10-04'), date: d('2026-10-04') }), prices, '2026-10-07');
    expect(p.legs[0]).toMatchObject({ entryDate: '2026-10-02', entryClose: 51 });
  });

  it('a return of exactly the target counts as a hit', () => {
    // (120 / 100 − 1) × 100 is 19.999999999999996 in floating point.
    const p = computePerformance(terms({ long: ['AAA'], target_return: 20 }), prices, '2026-10-07');
    expect(p.target?.hitDate).toBe('2026-10-07');
  });

  it('flags hits after the horizon', () => {
    const p = computePerformance(terms({ long: ['AAA'], target: 110, horizon: d('2026-10-05') }), prices, '2026-10-07');
    expect(p.target).toMatchObject({ hitDate: '2026-10-06', withinHorizon: false });
  });

  it('long: total return includes the dividend, price return does not', () => {
    const p = computePerformance(terms({ long: ['DIV'] }), prices, '2026-10-06');
    // Oct 2: (98 + 2) / 100 → total 0%, price −2%. Oct 6: 100/98 on top → total +2.04%, price 0%.
    expect(p.series[1]).toMatchObject({ date: '2026-10-02', value: 0 });
    expect(p.series[1].priceValue).toBeCloseTo(-2);
    expect(p.end.value).toBeCloseTo((100 / 98 - 1) * 100);
    expect(p.end.priceValue).toBeCloseTo(0);
    expect(p.legs[0].dividends).toEqual([{ date: '2026-10-02', amount: 2 }]);
  });

  it('short: pays the dividend', () => {
    const p = computePerformance(terms({ short: ['DIV'] }), prices, '2026-10-02');
    expect(p.end.priceValue).toBeCloseTo(2); // price fell 2%, a gain for a short...
    expect(p.end.value).toBeCloseTo(0); // ...but the 2 dividend paid wipes it out
  });

  it('dividend with ex-date on the entry date is not counted', () => {
    const p = computePerformance(terms({ long: ['DIV'], entry_date: d('2026-10-02'), date: d('2026-10-02') }), prices, '2026-10-06');
    expect(p.legs[0].dividends).toEqual([]);
    expect(p.end.value).toBeCloseTo((100 / 98 - 1) * 100);
  });

  it('dividend with ex-date on a holiday is applied at the next close', () => {
    const snap = { closes: { '2026-10-01': 100, '2026-10-06': 99 }, dividends: { '2026-10-03': 1 } };
    const p = computePerformance(terms({ long: ['X'] }), { X: snap }, '2026-10-06');
    expect(p.end.value).toBeCloseTo(0); // (99 + 1) / 100
  });

  it('split: no fake loss, and a price target is compared in entry-date share terms', () => {
    const p = computePerformance(terms({ long: ['SPL'], target: 115 }), prices, '2026-10-06');
    expect(p.series[1].value).toBeCloseTo(2); // 2 × 51 / 100
    expect(p.end.value).toBeCloseTo(20); // 2 × 60 / 100
    expect(p.target?.hitDate).toBe('2026-10-06'); // 60 × 2 = 120 ≥ 115
  });

  it('yield thesis ignores dividends', () => {
    const p = computePerformance(terms({ long: ['DIV'], unit: 'yield' }), prices, '2026-10-02');
    expect(p.end.value).toBeCloseTo(-200); // 100 → 98 = −2.00 points = −200bp
    expect(p.legs[0].dividends).toEqual([]);
  });

  it('errors clearly when prices are missing', () => {
    expect(() => computePerformance(terms({ long: ['ZZZ'] }), prices, '2026-10-07')).toThrow(/No price snapshot for ZZZ/);
    expect(() => computePerformance(terms({ long: ['AAA'], entry_date: d('2026-09-01') }), prices, '2026-10-07')).toThrow(
      /No AAA close on or before/,
    );
  });
});
