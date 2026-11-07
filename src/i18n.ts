// Languages of the site: English at the root, French under /fr/.
// Each French post has the same slug as its English original, so a page's
// counterpart in the other language is found by adding or removing /fr.

import { getCollection } from 'astro:content';
import { getRelativeLocaleUrl } from 'astro:i18n';
import { TRACKS, type Track } from './consts';

export type Lang = 'en' | 'fr';
export const LANGS: Lang[] = ['en', 'fr'];
export const DEFAULT_LANG: Lang = 'en';

export function asLang(locale: string | undefined): Lang {
	return locale === 'fr' ? 'fr' : 'en';
}

/** `/blog/x/` in the given language: `/blog/x/` or `/fr/blog/x/`. */
export function localize(lang: Lang, path: string): string {
	const url = getRelativeLocaleUrl(lang, path.replace(/^\//, ''));
	// The helper appends a slash; a file such as rss.xml must keep its bare name.
	return /\.[a-z0-9]+\/$/i.test(url) ? url.slice(0, -1) : url;
}

/** The path without its language prefix: `/fr/blog/x/` gives `/blog/x/`. */
export function unlocalize(pathname: string): string {
	const stripped = pathname.replace(/^\/fr(\/|$)/, '/');
	return stripped === '' ? '/' : stripped;
}

/** Published posts of one language, newest first. */
export async function getPosts(lang: Lang) {
	const posts = await getCollection(lang === 'fr' ? 'blogFr' : 'blog', ({ data }) => !data.draft);
	return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export const DATE_LOCALE: Record<Lang, string> = { en: 'en-GB', fr: 'fr-FR' };
export const HREFLANG: Record<Lang, string> = { en: 'en', fr: 'fr' };
export const OG_LOCALE: Record<Lang, string> = { en: 'en_GB', fr: 'fr_FR' };

export const SITE: Record<Lang, { title: string; description: string; role: string; sub: string }> = {
	en: {
		title: 'Tony Duong · Field notes',
		description:
			'Field notes from production by Tony Duong, fullstack and AI engineer in Bordeaux: coding with agents, Minima and EVM backends, servers. Measured before written.',
		role: 'Fullstack & AI engineer, Bordeaux',
		sub: 'Field notes',
	},
	fr: {
		title: 'Tony Duong · Notes de terrain',
		description:
			"Notes de terrain de Tony Duong, ingénieur fullstack et IA à Bordeaux : coder avec des agents, backends Minima et EVM, serveurs. Mesuré avant d'être écrit.",
		role: 'Ingénieur fullstack et IA, Bordeaux',
		sub: 'Notes de terrain',
	},
};

export const TRACKS_FR: Record<Track, { label: string; blurb: string }> = {
	'ai-engineering': {
		label: 'Coder avec des agents',
		blurb:
			"Travailler avec Claude Code en conditions de production : ce qu'il coûte, ce qu'il laisse fuiter, comment garder un vert honnête.",
	},
	minima: {
		label: 'Minima',
		blurb:
			"Une chaîne UTXO avec des MiniDapps : prouver l'inclusion, chaînes de test privées, garde multisig signée nœud par nœud.",
	},
	onchain: {
		label: 'Backends on-chain et DeFi',
		blurb:
			"Lire de l'argent chez des fournisseurs peu fiables, comptabilité LP sur Uniswap, endpoints RPC publics mesurés avant d'y croire.",
	},
	infrastructure: {
		label: 'Serveurs et infrastructure',
		blurb:
			"Plusieurs applications sur un même hôte, Docker et Traefik, migrations vers un PaaS auto-hébergé, fork d'un SaaS sous AGPL.",
	},
	security: {
		label: 'Sécurité',
		blurb:
			"Pièges de la chaîne d'approvisionnement, secrets qui voyagent, et que faire une fois que le code hostile a déjà tourné.",
	},
};

export function tracks(lang: Lang) {
	return lang === 'fr' ? TRACKS_FR : TRACKS;
}

export const UI = {
	en: {
		writing: 'Writing',
		about: 'About',
		language: 'Language',
		homeTitle: 'Field notes from production',
		homeLead:
			'I am Tony Duong, a fullstack and AI engineer in Bordeaux. I build DeFi backends on Minima and EVM chains, run the servers they live on, and write most of my code with an agent. Each note here comes from a measurement made on the job: a number, a command, a failure that was reproduced before it was explained.',
		notes: 'notes',
		aboutMe: 'about me',
		writingTitle: 'Writing · Tony Duong',
		writingLead: 'All notes, newest first. Dates are the day the work happened.',
		minRead: 'min read',
		updated: 'Updated',
		datedNote: 'Dated by when the work happened, then edited for publication.',
		howLink: 'How these notes are made.',
		allWriting: 'All writing',
		license: 'Text under',
		portfolio: 'Portfolio',
		source: 'Source of this site',
	},
	fr: {
		writing: 'Articles',
		about: 'À propos',
		language: 'Langue',
		homeTitle: 'Notes de terrain, tirées de la production',
		homeLead:
			"Je suis Tony Duong, ingénieur fullstack et IA à Bordeaux. Je construis des backends DeFi sur Minima et sur des chaînes EVM, j'administre les serveurs sur lesquels ils tournent, et j'écris l'essentiel de mon code avec un agent. Chaque note vient d'une mesure faite sur le terrain : un nombre, une commande, une panne reproduite avant d'être expliquée.",
		notes: 'notes',
		aboutMe: 'à propos',
		writingTitle: 'Articles · Tony Duong',
		writingLead: 'Toutes les notes, des plus récentes aux plus anciennes. La date est celle du jour où le travail a eu lieu.',
		minRead: 'min de lecture',
		updated: 'Mis à jour le',
		datedNote: 'Daté du jour où le travail a eu lieu, puis remis en forme pour la publication.',
		howLink: 'Comment ces notes sont faites.',
		allWriting: 'Tous les articles',
		license: 'Texte sous licence',
		portfolio: 'Portfolio',
		source: 'Code source de ce site',
	},
} satisfies Record<Lang, Record<string, string>>;
