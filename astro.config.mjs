// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://tonyduong-blog.vercel.app',
	i18n: {
		locales: ['en', 'fr'],
		defaultLocale: 'en',
		routing: { prefixDefaultLocale: false },
	},
	integrations: [
		mdx(),
		sitemap({
			i18n: { defaultLocale: 'en', locales: { en: 'en', fr: 'fr' } },
		}),
	],
	markdown: {
		shikiConfig: {
			themes: { light: 'github-light', dark: 'github-dark-dimmed' },
			wrap: false,
		},
	},
});
