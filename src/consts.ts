// Global site data, imported wherever it is needed.

export const SITE_TITLE = 'Tony Duong · Field notes';
export const SITE_DESCRIPTION =
	'Field notes from production by Tony Duong, fullstack and AI engineer in Bordeaux: coding with agents, Minima and EVM backends, servers. Measured before written.';
export const AUTHOR = 'Tony Duong';
export const AUTHOR_ROLE = 'Fullstack & AI engineer, Bordeaux';
export const GITHUB_URL = 'https://github.com/tonystechofficial';
export const PORTFOLIO_URL = 'https://tonystechofficial.github.io/';
export const REPO_URL = 'https://github.com/tonystechofficial/blog';

export type Track = 'ai-engineering' | 'minima' | 'onchain' | 'infrastructure' | 'security';

export const TRACK_ORDER: Track[] = ['ai-engineering', 'minima', 'onchain', 'infrastructure', 'security'];

export const TRACKS: Record<Track, { label: string; blurb: string }> = {
	'ai-engineering': {
		label: 'Coding with agents',
		blurb: 'Working with Claude Code in production conditions: what it costs, what it leaks, how to keep the green honest.',
	},
	minima: {
		label: 'Minima',
		blurb: 'A UTXO chain with MiniDapps: proving inclusion, private test chains, multisig custody signed node by node.',
	},
	onchain: {
		label: 'On-chain and DeFi backends',
		blurb: 'Reading money from unreliable providers, LP accounting on Uniswap, public RPC endpoints measured before trusted.',
	},
	infrastructure: {
		label: 'Servers and infrastructure',
		blurb: 'Several applications on one host, Docker and Traefik, self-hosted PaaS migrations, forking an AGPL SaaS.',
	},
	security: {
		label: 'Security',
		blurb: 'Supply-chain traps, secrets that travel, and what to do once the hostile code has already run.',
	},
};
