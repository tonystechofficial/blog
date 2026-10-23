---
title: "A freelance repo whose Tailwind plugin runs a remote payload"
description: "A clean-looking Next.js project from a freelance listing executed code from a remote server on npm run dev. The loader hid in the CSS config, behind a package npm audit cannot see."
pubDate: 2026-10-23
track: "security"
tags: ["security", "supply-chain", "npm", "malware", "freelance"]
sources: ["securite/depot-d-entretien-piege-chargeur-distant-dans-un-plugin-tailwind.md"]
---

## A mission that looked like any other

On October 23, 2026, a listing on a French freelance marketplace asked for a full-stack developer to "finalize and prepare for production" an AI fashion SaaS: users try clothes on virtually, Next.js 16, Prisma, NextAuth, Stripe. The client shared a private GitHub repository to start from. I cloned it and ran what anyone runs: `npm install && npm run dev`.

Everything looked normal. A tidy README, a believable list of "known issues", a `.env.example` already filled with test keys "to get started quickly". That last detail is the hook: a project that works out of the box is one you launch without reading.

It is the playbook of the campaign known as Contagious Interview, publicly attributed to North Korean operators and tracked under the names BeaverTail and InvisibleFerret. The usual version is a fake recruiter asking a candidate to "run and fix" a repository during a hiring process. Here the lure was a freelance mission, which is the same trick aimed at a population that clones client code for a living.

## The chain goes through the CSS config

No `postinstall` script, nothing in `package.json` that a quick review flags. The execution path is:

1. `tailwind.config.ts` loads a plugin, `tailwindcss-visual-kit`, presented as a wrapper around Animate.css.
2. That plugin depends on `@jasperquinn/postcss-motion-helpers`, a scoped package published as restricted. It only installs because the repository commits an `.npmrc` that carries an npm auth token.
3. Inside it, `src/config.js` weighs 181 KB on a single obfuscated line. A function called `normalizeOptions()` starts a background loop of ten attempts: it POSTs to a server on port 1224 at `/debugCheck`, base64-decodes the `message` field of the response, and runs it with `new Function('require', code)(require)`. The server address is itself hidden in base64, split and shuffled.
4. Tailwind evaluates its config on every CSS compilation. So `npm run dev`, `next build` or a bare `npx tailwindcss` all run the loader. `npm install --ignore-scripts` protects against nothing here.

Two more details make it robust. The single malicious commit added `predev` and `prestart` scripts that delete `.next`, so there is never a cache and the config is re-evaluated on every launch. And `config.js` checks for `--inspect` flags in `process.execArgv` and for analysis-related environment variables, to behave differently under a debugger.

## Why the scanners stay quiet

The public plugin contains only clean code. The payload lives in the restricted sub-dependency, which answers 404 to any anonymous request: I checked again on October 24, the plugin is still listed on npm and the sub-dependency is still invisible. That means `npm audit`, Socket, Snyk, and anyone reading the registry without the token, see nothing wrong. The token in the repository is not a mistake by the attacker. It is the delivery mechanism.

The history tells the same story. The plugin was published on October 9, first as `0.0.0-stage`, then as `1.3.6` two minutes later, a version number chosen to look mature. The malicious commit landed the same afternoon, titled "Refactor code structure for improved readability", from an account a few months old. The earlier commits, dated May, look like a genuine project that was picked up and armed. The GitHub organization hosting it was three days old when the plugin went up, and the source repositories declared in both `package.json` files do not exist.

## It ran

The sign was a line in the dev server output: `ps: unknown option -- o`. No installed package calls `ps`. That was the downloaded payload listing processes. A moment later Turbopack crashed its PostCSS worker and every page answered 500.

The server, looked up through passive sources only and never contacted: a VPS with no reverse DNS at a hosting brand that shows up regularly in reports on state-sponsored infrastructure, running Ubuntu, nginx, and Node.js/Express on port 1224. That stack is the usual shape of a BeaverTail command server.

That evening I posted a warning in the marketplace's community Discord, in the channel where freelancers compare notes on doubtful listings. In substance: this project is an attack built to collect secrets (SSH keys, `.env` files, wallet keys, browser cookies), and the private repository they share pulls in `tailwindcss-visual-kit` and `@jasperquinn/postcss-motion-helpers`, which are the malware. Another freelancer thanked me within the half hour. That is the cheapest and fastest defense there is: the next freelancer reads it before cloning.

## Signals before you install

- An `.npmrc` with an auth token in a repository someone hands you. There is no legitimate reason for it.
- A little-known CSS or PostCSS plugin, with different authors on the plugin and its sub-dependency, and a restricted scoped package in the tree.
- A "config" or "options" file of tens of kilobytes on one line.
- `fetch`, `new Function`, `eval` or `Buffer.from(..., 'base64')` in code that is supposed to transform CSS.
- A `.env.example` full of real-looking keys, there to make you launch without thinking.
- Port 1224 (also 1244 and 1245): the signature of BeaverTail servers.

A check that runs nothing: grep the unknown packages in `node_modules` for `new Function|eval\(|child_process`, and read the `package.json` of every direct dependency you do not recognize. Better: run any repository received from a stranger, recruiter or client, only in a throwaway VM or container with no secrets mounted.

## Once it has run

- Killing the process tree is not enough. The payload had time to read the disk. Known variants take browser passwords and cookies, wallet extensions (MetaMask, Phantom), `.env` files, SSH keys and the content of `~/.config`. Some install a Python backdoor or a persistence entry.
- Do not contact the command server to "see what it returns".
- Treat every secret readable by your user as exposed, and rotate from another, clean machine. A keylogger makes a rotation done on the infected one useless.
- Keep the repository and `node_modules` as evidence for the reports.

Report what cuts distribution first: npm (the "Report malware" link on the package page, both packages, the publishing account, and the token in private only), GitHub (the repository, the organization, the commit), and an issue on OpenSSF `malicious-packages`, the database that feeds OSV, Socket and Snyk. Then the hosting provider's abuse address, the platform where the first contact happened, and in France cybermalveillance.gouv.fr. A police complaint matters when there is an actual loss, such as stolen funds or accounts.

## What I keep

- A dev server is an execution environment. Anything your build tool evaluates, Tailwind and PostCSS configs included, runs with your rights.
- `--ignore-scripts` covers install hooks only. A loader in a config file walks right past it.
- A token in an `.npmrc` you did not write is a red flag on its own: it is how a payload hides from every public scanner.
- Clone strangers' code into something you can throw away. The machine that holds your keys is not a test bench.
- Warn the community where the lure was posted. It costs one message and it reaches the next person before the attacker does.
