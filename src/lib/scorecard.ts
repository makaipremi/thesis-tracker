/**
 * Track-record statistics, computed from thesis files and frozen prices only —
 * never typed by hand. Every thesis is included; nothing is filtered out.
 */
import type { Unit } from './scoring';
import type { Outcome } from './threads';

/** The minimum the scorecard needs from each thesis. */
export interface ScoreInput {
	status: 'open' | 'closed';
	outcome?: Outcome;
	unit: Unit;
	/** Headline return at close (closed) or latest mark (open); undefined while prices are pending. */
	value?: number;
	entryDate?: string;
	closeDate?: string;
}

export interface ReturnStats {
	count: number;
	average: number;
	median: number;
	best: number;
	worst: number;
	positive: number; // how many finished above zero
}

export interface Scorecard {
	total: number;
	open: number;
	closed: number;
	pending: number; // prices not yet available
	outcomes: Record<Outcome, number>;
	/** Your call: won ÷ all closed (invalidated and expired count against). */
	winRate?: number;
	/** Closed theses where your call and the sign of the return disagree (won but negative, lost but positive). */
	disagreements: number;
	/** Closed-thesis returns, kept apart by unit: % and bp can't be averaged together. */
	closedReturns: Partial<Record<Unit, ReturnStats>>;
	openReturns: Partial<Record<Unit, ReturnStats>>;
	averageDaysHeld?: number;
}

export function returnStats(values: number[]): ReturnStats | undefined {
	if (values.length === 0) return undefined;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length / 2;
	return {
		count: values.length,
		average: values.reduce((a, v) => a + v, 0) / values.length,
		median: sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2,
		best: sorted.at(-1)!,
		worst: sorted[0],
		positive: values.filter((v) => v > 0).length,
	};
}

function byUnit(rows: ScoreInput[]): Partial<Record<Unit, ReturnStats>> {
	const out: Partial<Record<Unit, ReturnStats>> = {};
	for (const unit of ['price', 'yield'] as const) {
		const stats = returnStats(rows.filter((r) => r.unit === unit && r.value !== undefined).map((r) => r.value!));
		if (stats) out[unit] = stats;
	}
	return out;
}

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function computeScorecard(rows: ScoreInput[]): Scorecard {
	const closed = rows.filter((r) => r.status === 'closed');
	const open = rows.filter((r) => r.status === 'open');
	const outcomes: Record<Outcome, number> = { won: 0, lost: 0, invalidated: 0, expired: 0 };
	for (const r of closed) outcomes[r.outcome!]++;

	const closedPriced = closed.filter((r) => r.value !== undefined);
	const held = closed.filter((r) => r.entryDate && r.closeDate).map((r) => days(r.entryDate!, r.closeDate!));

	return {
		total: rows.length,
		open: open.length,
		closed: closed.length,
		pending: rows.filter((r) => r.value === undefined).length,
		outcomes,
		winRate: closed.length ? outcomes.won / closed.length : undefined,
		disagreements: closedPriced.filter(
			(r) => (r.outcome === 'won' && r.value! < 0) || (r.outcome === 'lost' && r.value! > 0),
		).length,
		closedReturns: byUnit(closed),
		openReturns: byUnit(open),
		averageDaysHeld: held.length ? held.reduce((a, d) => a + d, 0) / held.length : undefined,
	};
}
