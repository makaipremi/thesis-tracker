import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { loadTheses } from '../lib/data';
import { url } from '../lib/format';
import { postProofs } from '../lib/proofs';

/** One feed item per post (opening posts and replies), newest first. */
export async function GET(context: APIContext) {
	const theses = await loadTheses();

	const items = theses.flatMap(({ thread }) => {
		const o = thread.opening.data;
		const link = (postId: string) => `${url(`theses/${thread.slug}/`)}#${postId.split('/')[1]}`;
		// The guid carries the post file's hash, so an edited post reaches readers as a new item
		// instead of being deduped against the copy they already fetched.
		const guid = (post: { id: string; filePath?: string }) =>
			`<guid isPermaLink="false">${link(post.id)}@${postProofs(post.filePath!).sha256.slice(0, 12)}</guid>`;
		const snippet = (body = '') => {
			const text = body.replace(/\s+/g, ' ').trim();
			return text.length > 280 ? `${text.slice(0, 277)}…` : text;
		};
		return [
			{
				title: `#${thread.number} ${o.title}`,
				pubDate: o.date,
				link: link(thread.opening.id),
				description: snippet(thread.opening.body),
				customData: guid(thread.opening),
			},
			...thread.replies.map((r) => ({
				title: `#${thread.number} ${o.title} — ${r.data.close ? `Closed: ${r.data.close}` : (r.data.title ?? 'Update')}`,
				pubDate: r.data.date,
				link: link(r.id),
				description: snippet(r.body),
				customData: guid(r),
			})),
		];
	});

	return rss({
		title: 'Thesis Tracker — Alpha Beta Generator',
		description: 'New investment theses and updates, timestamped and tracked against market prices.',
		site: new URL(url(), context.site),
		// Links are built complete; don't let the site-wide trailing slash land after the #anchor.
		trailingSlash: false,
		items: items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime()),
	});
}
