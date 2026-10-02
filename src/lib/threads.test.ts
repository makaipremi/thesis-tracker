import { describe, expect, it } from 'vitest';
import { buildThreads, type OpeningData, type PostEntry, type ReplyData } from './threads';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
// Fixed build date so these tests don't depend on when they run.
const build = (o: PostEntry<OpeningData>[], r: PostEntry<ReplyData>[]) => buildThreads(o, r, '2027-01-01');
const open = (id: string, date: string): PostEntry<OpeningData> => ({ id, data: { date: d(date), title: 'T' } });
const reply = (id: string, date: string, close?: ReplyData['close']): PostEntry<ReplyData> => ({
  id,
  data: { date: d(date), close },
});

describe('buildThreads', () => {
  it('groups, sorts replies and records the close', () => {
    const [t] = build(
      [open('0001-abc/2026-10-01-open', '2026-10-01')],
      [reply('0001-abc/2026-12-01-close', '2026-12-01', 'won'), reply('0001-abc/2026-11-01-q3', '2026-11-01')],
    );
    expect(t.number).toBe(1);
    expect(t.replies.map((r) => r.id)).toEqual(['0001-abc/2026-11-01-q3', '0001-abc/2026-12-01-close']);
    expect(t.close?.outcome).toBe('won');
  });

  const fails = (o: PostEntry<OpeningData>[], r: PostEntry<ReplyData>[], msg: RegExp) =>
    expect(() => build(o, r)).toThrow(msg);

  it('rejects a reply with no opening post', () =>
    fails([], [reply('0001-abc/2026-11-01-q3', '2026-11-01')], /no opening post/));

  it('rejects two opening posts in one folder', () =>
    fails([open('0001-abc/2026-10-01-open', '2026-10-01'), open('0001-abc/2026-10-02-open', '2026-10-02')], [], /more than one opening/));

  it('rejects a file name date that does not match `date`', () =>
    fails([open('0001-abc/2026-10-01-open', '2026-10-02')], [], /doesn't match/));

  it('rejects a reply dated before the opening', () =>
    fails([open('0001-abc/2026-10-01-open', '2026-10-01')], [reply('0001-abc/2026-09-01-early', '2026-09-01')], /before the opening/));

  it('rejects posts after a close', () =>
    fails(
      [open('0001-abc/2026-10-01-open', '2026-10-01')],
      [reply('0001-abc/2026-11-01-close', '2026-11-01', 'lost'), reply('0001-abc/2026-11-05-oops', '2026-11-05')],
      /on or after the closing post/,
    ));

  it('rejects closing twice', () =>
    fails(
      [open('0001-abc/2026-10-01-open', '2026-10-01')],
      [reply('0001-abc/2026-11-01-close', '2026-11-01', 'lost'), reply('0001-abc/2026-11-05-close', '2026-11-05', 'won')],
      /closed more than once/,
    ));

  it('rejects posts dated in the future, allowing one day for time zones', () => {
    const o = [open('0001-abc/2026-10-01-open', '2026-10-01')];
    expect(() => buildThreads(o, [reply('0001-abc/2026-10-11-q3', '2026-10-11')], '2026-10-10')).not.toThrow();
    expect(() => buildThreads(o, [reply('0001-abc/2026-10-12-q3', '2026-10-12')], '2026-10-10')).toThrow(/in the future/);
  });

  it('rejects duplicate thread numbers and bad folder names', () => {
    fails([open('0001-abc/2026-10-01-open', '2026-10-01'), open('0001-xyz/2026-10-01-open', '2026-10-01')], [], /already used/);
    fails([open('abc/2026-10-01-open', '2026-10-01')], [], /thread folder must look like/);
  });
});
