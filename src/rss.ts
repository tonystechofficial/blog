import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { type Lang, SITE, getPosts, localize } from './i18n';

/** RSS feed of one language: /rss.xml or /fr/rss.xml. */
export async function feed(lang: Lang, context: APIContext) {
	const posts = await getPosts(lang);
	return rss({
		title: SITE[lang].title,
		description: SITE[lang].description,
		site: context.site!,
		customData: `<language>${lang}</language>`,
		items: posts.map((post) => ({
			title: post.data.title,
			description: post.data.description,
			pubDate: post.data.pubDate,
			categories: [post.data.track, ...post.data.tags],
			link: localize(lang, `/blog/${post.id}/`),
		})),
	});
}
