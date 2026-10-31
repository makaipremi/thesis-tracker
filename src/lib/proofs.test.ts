import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { postProofs } from './proofs';

const POST = 'src/content/theses/0001-abc/2026-11-01-open.md';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const PENDING = Buffer.from('83dfe30d2ef90c8e', 'hex');
const BITCOIN = Buffer.from('0588960d73d71901', 'hex');

let root: string;
const write = (rel: string, data: string | Buffer) => {
	mkdirSync(join(root, rel, '..'), { recursive: true });
	writeFileSync(join(root, rel), data);
};
const proof = (digest: string, confirmed: boolean) =>
	write(`proofs/0001-abc/2026-11-01-open/${digest}.ots`, Buffer.concat([PENDING, confirmed ? BITCOIN : Buffer.alloc(0)]));

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'proofs-'));
	write(POST, 'v1\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('postProofs', () => {
	it('missing when nothing has been stamped', () => {
		expect(postProofs(POST, root)).toMatchObject({ status: 'missing', sha256: sha('v1\n'), earlier: [] });
	});

	it('pending until the Bitcoin attestation is attached, then confirmed', () => {
		proof(sha('v1\n'), false);
		expect(postProofs(POST, root).status).toBe('pending');
		proof(sha('v1\n'), true);
		const p = postProofs(POST, root);
		expect(p.status).toBe('confirmed');
		expect(p.current?.path).toBe(`proofs/0001-abc/2026-11-01-open/${sha('v1\n')}.ots`);
	});

	it('an edited post: the new version needs its own proof; the old one is listed as earlier', () => {
		proof(sha('v1\n'), true);
		write(POST, 'v2 edited\n');
		const p = postProofs(POST, root);
		expect(p.status).toBe('missing');
		expect(p.earlier.map((e) => e.sha256)).toEqual([sha('v1\n')]);
	});
});
