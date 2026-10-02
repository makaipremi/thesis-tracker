/**
 * Groups posts into threads and enforces the rules that a per-file schema can't:
 * one opening post per folder, dates that match file names, replies after the
 * opening, and nothing posted after a thread is closed.
 */

export type Outcome = 'won' | 'lost' | 'invalidated' | 'expired';

export interface PostEntry<D> {
  id: string; // "<folder>/<file name without .md>", as produced by the glob loader
  data: D;
}

export interface OpeningData {
  date: Date;
  title: string;
}

export interface ReplyData {
  date: Date;
  title?: string;
  close?: Outcome;
}

export interface Thread<O extends OpeningData, R extends ReplyData> {
  slug: string; // folder name, e.g. "0001-xyz-long"
  number: number; // leading number of the folder, e.g. 1
  opening: PostEntry<O>;
  replies: PostEntry<R>[]; // sorted by date
  close?: { date: Date; outcome: Outcome; post: PostEntry<R> };
}

const FOLDER = /^(\d{4})-[a-z0-9-]+$/;
const FILE = /^(\d{4}-\d{2}-\d{2})-[a-z0-9-]+$/;

const iso = (d: Date) => d.toISOString().slice(0, 10);

function split(id: string): { folder: string; file: string } {
  const [folder, file, ...rest] = id.split('/');
  if (!folder || !file || rest.length) throw new Error(`Post "${id}" must be directly inside a thread folder.`);
  return { folder, file };
}

/**
 * @param today ISO date of the build (UTC). Posts dated after it are rejected, with one
 * day of slack: a post written in Asia is often already dated "tomorrow" relative to UTC.
 */
export function buildThreads<O extends OpeningData, R extends ReplyData>(
  openings: PostEntry<O>[],
  replies: PostEntry<R>[],
  today: string = iso(new Date()),
): Thread<O, R>[] {
  const errors: string[] = [];
  const bySlug = new Map<string, Thread<O, R>>();
  const latestAllowed = iso(new Date(Date.parse(today) + 86_400_000));

  const checkFileDate = (id: string, file: string, date: Date) => {
    const m = FILE.exec(file);
    if (!m) errors.push(`${id}: file name must look like YYYY-MM-DD-some-name.md`);
    else if (m[1] !== iso(date)) errors.push(`${id}: file name date ${m[1]} doesn't match \`date: ${iso(date)}\``);
    if (iso(date) > latestAllowed) errors.push(`${id}: dated ${iso(date)}, which is in the future`);
  };

  for (const o of openings) {
    const { folder, file } = split(o.id);
    const m = FOLDER.exec(folder);
    if (!m) {
      errors.push(`${folder}: thread folder must look like 0001-short-name (lowercase, digits, hyphens)`);
      continue;
    }
    checkFileDate(o.id, file, o.data.date);
    if (bySlug.has(folder)) {
      errors.push(`${folder}: has more than one opening post`);
      continue;
    }
    bySlug.set(folder, { slug: folder, number: Number(m[1]), opening: o, replies: [] });
  }

  for (const r of replies) {
    const { folder, file } = split(r.id);
    checkFileDate(r.id, file, r.data.date);
    const thread = bySlug.get(folder);
    if (!thread) {
      errors.push(`${r.id}: reply has no opening post (*-open.md) in its folder`);
      continue;
    }
    if (r.data.date < thread.opening.data.date) {
      errors.push(`${r.id}: reply is dated before the opening post (${iso(thread.opening.data.date)})`);
    }
    thread.replies.push(r);
  }

  const numbers = new Map<number, string>();
  for (const t of bySlug.values()) {
    const clash = numbers.get(t.number);
    if (clash) errors.push(`${t.slug}: thread number ${t.number} is already used by ${clash}`);
    numbers.set(t.number, t.slug);

    t.replies.sort((a, b) => a.data.date.getTime() - b.data.date.getTime() || a.id.localeCompare(b.id));
    const closes = t.replies.filter((r) => r.data.close);
    if (closes.length > 1) errors.push(`${t.slug}: closed more than once (${closes.map((c) => c.id).join(', ')})`);
    if (closes.length) {
      const c = closes[0];
      const after = t.replies.filter((r) => r !== c && r.data.date >= c.data.date);
      if (after.length) {
        errors.push(`${t.slug}: posts on or after the closing post ${c.id}: ${after.map((r) => r.id).join(', ')}`);
      }
      t.close = { date: c.data.date, outcome: c.data.close!, post: c };
    }
  }

  if (errors.length) throw new Error(`Thesis threads are invalid:\n  - ${errors.join('\n  - ')}`);
  return [...bySlug.values()].sort((a, b) => a.number - b.number);
}
