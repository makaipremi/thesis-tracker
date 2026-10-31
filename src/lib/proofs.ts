/**
 * Reads OpenTimestamps proofs for a post at build time. Proofs live at
 * proofs/<thread>/<post>/<sha256-of-file>.ots, one per version of the post
 * (see scripts/stamp.py).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

/** Marks a Bitcoin block-header attestation; pending proofs don't have it yet. */
const BITCOIN_TAG = Buffer.from('0588960d73d71901', 'hex');

export type ProofStatus = 'confirmed' | 'pending' | 'missing';

export interface Proof {
	sha256: string;
	path: string; // repo-relative, forward slashes
	confirmed: boolean;
}

export interface PostProofs {
	status: ProofStatus; // of the current version
	sha256: string; // of the current file
	current?: Proof;
	earlier: Proof[]; // proofs of previous versions of this post
}

const toPosix = (p: string) => p.split('\\').join('/');

/**
 * @param postFile path to the post's .md file, relative to `root`
 *                 (e.g. src/content/theses/0001-x/2026-11-01-open.md)
 */
export function postProofs(postFile: string, root: string = process.cwd()): PostProofs {
	const sha256 = createHash('sha256').update(readFileSync(join(root, postFile))).digest('hex');
	const rel = relative(join(root, 'src/content/theses'), join(root, postFile));
	const dir = join(root, 'proofs', dirname(rel), basename(rel, '.md'));

	const proofs: Proof[] = existsSync(dir)
		? readdirSync(dir)
				.filter((f) => f.endsWith('.ots'))
				.map((f) => {
					const full = join(dir, f);
					return {
						sha256: f.slice(0, -'.ots'.length),
						path: toPosix(relative(root, full)),
						confirmed: readFileSync(full).includes(BITCOIN_TAG),
					};
				})
		: [];

	const current = proofs.find((p) => p.sha256 === sha256);
	return {
		status: current ? (current.confirmed ? 'confirmed' : 'pending') : 'missing',
		sha256,
		current,
		earlier: proofs.filter((p) => p !== current),
	};
}
