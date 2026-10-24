import { describe, expect, it } from 'vitest';
import { computeScorecard, returnStats, type ScoreInput } from './scorecard';

const row = (r: Partial<ScoreInput>): ScoreInput => ({
	status: 'closed',
	unit: 'price',
	...r,
});

describe('returnStats', () => {
	it('average, median (odd and even), best, worst, positives', () => {
		expect(returnStats([5, -2, 10])).toEqual({ count: 3, average: 13 / 3, median: 5, best: 10, worst: -2, positive: 2 });
		expect(returnStats([1, 2, 3, 4])?.median).toBe(2.5);
		expect(returnStats([])).toBeUndefined();
	});
});

describe('computeScorecard', () => {
	const rows: ScoreInput[] = [
		row({ outcome: 'won', value: 12, entryDate: '2026-01-01', closeDate: '2026-01-31' }),
		row({ outcome: 'won', value: -1, entryDate: '2026-01-01', closeDate: '2026-03-02' }), // judged won, numbers say loss
		row({ outcome: 'lost', value: -8 }),
		row({ outcome: 'invalidated', value: -3 }),
		row({ outcome: 'expired', unit: 'yield', value: 15 }),
		row({ status: 'open', value: 4 }),
		row({ status: 'open' }), // prices pending
	];
	const s = computeScorecard(rows);

	it('counts everything, including pending', () => {
		expect(s).toMatchObject({ total: 7, open: 2, closed: 5, pending: 1 });
		expect(s.outcomes).toEqual({ won: 2, lost: 1, invalidated: 1, expired: 1 });
	});

	it('win rate counts invalidated and expired against you', () => {
		expect(s.winRate).toBeCloseTo(2 / 5);
	});

	it('flags outcomes that disagree with the sign of the return', () => {
		expect(s.disagreements).toBe(1); // won at −1
	});

	it('keeps % and bp apart', () => {
		expect(s.closedReturns.price).toMatchObject({ count: 4, best: 12, worst: -8, median: -2 });
		expect(s.closedReturns.yield).toMatchObject({ count: 1, average: 15 });
		expect(s.openReturns.price).toMatchObject({ count: 1, average: 4 });
		expect(s.openReturns.yield).toBeUndefined();
	});

	it('average days held from entry to close', () => {
		expect(s.averageDaysHeld).toBe(45); // 30 and 60
	});

	it('handles no theses at all', () => {
		const empty = computeScorecard([]);
		expect(empty).toMatchObject({ total: 0, winRate: undefined, closedReturns: {}, openReturns: {} });
	});
});
