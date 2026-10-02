/**
 * The one place pages get thesis data from. Loads posts and frozen prices,
 * validates threads (throws → build fails), and computes performance.
 */
import { getCollection, type CollectionEntry } from 'astro:content';
import { computePerformance, iso, PriceDataError, type Performance, type Prices, type Snapshot } from './scoring';
import { buildThreads, type Thread } from './threads';

type Opening = CollectionEntry<'opening'>;
type Reply = CollectionEntry<'replies'>;

export interface ThesisView {
  thread: Thread<Opening['data'], Reply['data']>;
  status: 'open' | 'closed';
  performance?: Performance;
  /** Why performance is missing, e.g. prices not fetched yet. */
  pending?: string;
}

const snapshots = import.meta.glob<Snapshot & { symbol: string }>('/prices/*.json', {
  eager: true,
  import: 'default',
});

export const prices: Prices = Object.fromEntries(Object.values(snapshots).map((s) => [s.symbol, s]));

let cache: ThesisView[] | undefined;

export async function loadTheses(): Promise<ThesisView[]> {
  if (cache) return cache;
  const threads = buildThreads<Opening['data'], Reply['data']>(
    await getCollection('opening'),
    await getCollection('replies'),
  );
  const today = iso(new Date());

  cache = threads.map((thread) => {
    const status = thread.close ? 'closed' : 'open';
    const end = thread.close ? iso(thread.close.date) : today;
    try {
      return { thread, status, performance: computePerformance(thread.opening.data, prices, end) };
    } catch (e) {
      if (e instanceof PriceDataError) return { thread, status, pending: e.message };
      throw new Error(`${thread.slug}: ${(e as Error).message}`);
    }
  });
  return cache;
}
