import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * A thesis is a thread: a folder under src/content/theses/ holding one opening
 * post (`YYYY-MM-DD-open.md`) and any number of dated replies (`YYYY-MM-DD-<slug>.md`).
 * Post files are append-only — once committed they are never edited.
 */
const THESES = './src/content/theses';

/**
 * A leg is a Yahoo Finance symbol, optionally with a weight (position size, any units:
 * 100 long vs 50 short is fine). Unweighted legs count as 1. Thesis return is
 * total P&L divided by gross size (sum of all weights, long + short).
 */
const leg = z.union([
  z.string().min(1),
  z.strictObject({ symbol: z.string().min(1), weight: z.number().positive() }),
]);

const legs = z.array(leg).default([]);

/** Weights are all-or-none across the whole thesis, so plain and weighted legs never mix. */
function weightsAllOrNone(all: z.infer<typeof legs>): boolean {
  const weighted = all.filter((l) => typeof l !== 'string').length;
  return weighted === 0 || weighted === all.length;
}

const opening = defineCollection({
  loader: glob({ pattern: '**/*-open.md', base: THESES }),
  schema: z
    .strictObject({
      title: z.string().min(1),
      date: z.coerce.date(),
      long: legs,
      short: legs,
      entry_date: z.coerce.date(),
      unit: z.enum(['price', 'yield']).default('price'),
      target: z.number().optional(),
      target_return: z.number().optional(),
      horizon: z.coerce.date().optional(),
      wrong_if: z.string().min(1).optional(),
    })
    .refine((t) => t.long.length + t.short.length > 0, {
      message: 'At least one leg is required in `long` or `short`.',
    })
    .refine((t) => weightsAllOrNone([...t.long, ...t.short]), {
      message: 'Give a weight for every leg (long and short) or for none.',
    })
    .refine((t) => !(t.target !== undefined && t.target_return !== undefined), {
      message: 'Use either `target` or `target_return`, not both.',
    })
    .refine((t) => t.target === undefined || t.long.length + t.short.length === 1, {
      message: '`target` (a price level) is for single-leg theses; use `target_return` for pairs and baskets.',
    })
    .refine((t) => t.horizon === undefined || t.horizon > t.date, {
      message: '`horizon` must be after the posting `date`.',
    }),
});

const replies = defineCollection({
  loader: glob({ pattern: ['**/*.md', '!**/*-open.md'], base: THESES }),
  schema: z.strictObject({
    date: z.coerce.date(),
    title: z.string().min(1).optional(),
    close: z.enum(['won', 'lost', 'invalidated', 'expired']).optional(),
  }),
});

export const collections = { opening, replies };
