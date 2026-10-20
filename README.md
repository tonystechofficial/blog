# Field notes · Tony Duong

Engineering notes from production: coding with agents, Minima and EVM backends, servers and
infrastructure. Each post comes from a working note with a measurement in it, and is dated by the
day the work happened.

Live: https://tonyduong-blog.vercel.app

## Stack

- [Astro](https://astro.build) 7, content collections, MDX, RSS, sitemap. No client-side JavaScript.
- Fonts from Google Fonts (IBM Plex Sans, IBM Plex Mono, Source Serif 4).
- Deployed on Vercel as a static site (`vercel --prod`).

## Write a post

Create `src/content/blog/<slug>.md`:

```markdown
---
title: "A short, specific title"
description: "One sentence, at most 160 characters: the claim of the piece."
pubDate: 2026-10-20          # the day the work happened
track: "ai-engineering"      # ai-engineering | minima | onchain | infrastructure
tags: ["claude-code", "cost"]
sources: ["claude-code/some-note.md"]   # optional, not rendered
draft: false                 # true hides the post from the site and the feed
---

Body in Markdown. Use H2 headings; the title is rendered by the layout.
```

Rules the posts follow: first person, measured facts only, no client names, hosts, identifiers
or secrets. A fact the notes do not support is left out.

## Run

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # static output in dist/
npm run preview
```

## Deploy

```bash
vercel --prod
```

## License

Text of the posts: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) Tony Duong.
Site code: MIT.
