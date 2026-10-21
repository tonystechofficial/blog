---
title: "A Polymarket scanner sized for ten milliseconds of CPU"
description: "Cloudflare's free tier gives a cron run 10 ms of CPU and 50 subrequests. I sized a read-only Polymarket scanner to that budget and measured what the docs do not say."
pubDate: 2026-10-21
track: "onchain"
tags: ["polymarket", "cloudflare-workers", "d1", "workers-ai", "free-tier", "prediction-markets"]
sources: ["infra/scanner-planifie-dans-le-plan-gratuit-cloudflare-workers-d1-workers-ai.md", "defi/polymarket-api-publique-lecture-gamma-clob-frais-geoblocage.md", "node/tsc-epuise-la-memoire-sur-un-generique-zod-4-et-deux-copies-de-zod.md"]
draft: false
---

## The budget is ten milliseconds, not ten seconds

On 21 October 2026 I built a scanner of Polymarket markets that has to cost nothing per month: a Cloudflare Worker on a cron trigger, a D1 database, Workers AI for a structured reading of resolution rules, and a static dashboard served by the same Worker. Read-only, simulation-only, no wallet anywhere. The code is open source at github.com/tonystechofficial/polymarket-edge-scanner.

Before writing a line I copied the limits from the documentation, because they are the design. A Workers Free invocation gets 10 ms of CPU, and a cron run is an invocation. It gets 50 subrequests and 50 D1 queries. A D1 query takes at most 100 bound parameters. Workers AI gives 10,000 neurons a day and fails, rather than bills, past that. Requests for static assets are free and unlimited, which is why the dashboard is a folder of files and not a server-rendered page.

Ten milliseconds of CPU rule out everything that looks like a job. Each run does one thing: a discovery (one Gamma request, at most 24 markets kept) or a pricing slice (one CLOB request for 8 markets, 16 order books), then one resolution check, then at most one model call. The cursor lives in D1, the lock is a single upsert with a `WHERE value < now` clause, and every budget is counted so a run stops itself before the platform stops it. The first version wrote 24 markets with 24 statements and touched the 50-query ceiling; four rows per statement keep it under 40.

## Polymarket publishes the fee per market

Nothing here needs a key. Gamma's `/events` returns the markets of an event with their tags in one request, so the category comes free. The fields that look like arrays are JSON strings. Each market carries a `feeSchedule`: on 21 October an NBA game had a taker rate of 0, a Brazilian election market 0.04, a daily Bitcoin market 0.07, with the official formula `shares × rate × p(1−p)`. The `takerBaseFee: 1000` next to it does not convert into that rate, so the schedule is the source and 0.07 is the assumption when it is missing.

The CLOB's `POST /books` prices a hundred tokens in one request, levels sorted worst first. One measurement changed the strategy: the NO book is the mirror of the YES book. I read YES at 0.67 / 0.68 and NO at 0.32 / 0.33 on the same market. So "YES ask plus NO ask below one" cannot happen in a consistent snapshot, and when it shows up it means the two books were read at different moments. The only structural edge left is across the outcomes of a negative-risk event, when the YES asks of every outcome sum below one after fees, and the scanner only simulates it when the whole outcome set sits in the same batch.

The scanner also calls the official geoblock endpoint and shows the answer instead of routing around it. From my machine the answer was blocked, country NL. From the Worker's egress it was blocked, country NL as well. Trading is impossible in this build anyway; the display is there so nobody wonders.

## The model on the JSON-mode page was deprecated five months ago

I picked `@cf/meta/llama-3.1-8b-instruct` because the JSON-mode page of the documentation lists it. The first production call answered error 5028: deprecated on 2026-05-30. Nothing before the call says so. The scanner survived as designed, wrote an error row and carried on, and now latches a model reported as deprecated so it is not called again until the configuration changes.

Four live candidates, same prompt, same JSON schema, measured on the deployed Worker:

| Model | Valid JSON | Neurons per call | Run wall time |
| --- | --- | --- | --- |
| llama-3.1-8b-instruct-fp8-fast | 4 of 4 | 7.8 to 13.7 | 1.1 to 2.3 s |
| granite-4.0-h-micro | 4 of 4 | 2.6 to 3.7 | 5.0 to 9.1 s |
| qwen3-30b-a3b-fp8 | 0 of 1 | 15.8 to 17.3 | 3.4 to 4.5 s |
| gpt-oss-20b | 0 of 1 | 24.9 | 5.2 s |

The two reasoning models spent the whole 450-token output budget thinking and returned no JSON. The newer models also answer in the OpenAI envelope, `choices[0].message.content`, with `response` set to null, so a parser written for the legacy `{ response }` shape rejected three of the four before the schema even saw them. At 60 calls a day the default model uses under 10 % of the free neurons.

The model is boxed in: it reads the question and the resolution rules, must return a schema, and a guard nulls any probability that comes without two pieces of evidence, a source and fresh data. In 17 runs every analysis came back with a null probability and `INSUFFICIENT_EVIDENCE`, which is the correct answer for a model with no web access reading a question about the future.

## What the first production runs measured

Without a Cloudflare credential on the machine, `wrangler deploy --temporary` creates a preview account that can be claimed from a link valid for 59 minutes. D1 creation, migrations, the deploy and a secret all accept the flag. The one limit that differs from a normal free account is 0 cron triggers, so the runs below were manual.

Worker startup took 17 ms. A discovery run read 20 events, kept 24 markets, rejected 210 with a reason (100 closed, 108 inactive, 2 past their end date), used 2 subrequests and 448 ms of wall time. A pricing run read 16 books in 1 subrequest and wrote 8 signals in 581 ms. All 17 runs finished `ok`, with at most 2 subrequests each. All 25 value signals were rejected with `INSUFFICIENT_EVIDENCE`: the estimator only speaks when a price bin holds 30 resolved markets it observed itself, and a fresh deployment has none. That is the honest state of a value model on day one, and the dashboard says so next to each signal.

## One generic signature cost six gigabytes

The type-check of the workspace ran 80 seconds and died out of memory at 6 GB. Bisecting by `include`, four throwaway configs in parallel, pointed at one package in ten minutes. The cause was `fetchJson<T>(url, schema: ZodType<T>)`: with zod 4, inferring `T` through the schema's internals does not finish in practice, and a second copy of zod nested under the packages (4.6.5 pinned at the root by the Cloudflare Vitest plugin, 4.6.7 requested by the packages) made the compiler compare two identical type trees. Constraining on the schema, `S extends ZodType<any, any>` with `z.output<S>`, and keeping one version brought the same 359 files to 0.85 s and 205 MB.

## What is left

The deployment on my own account waits for a browser click on Cloudflare's OAuth consent; the scripts after it are tested. The calibration table is empty until markets resolve, so the first weeks will produce rejections only, and the comparison with the market-implied baseline only means something after that. The numbers above are measurements of a platform and of a first model, not a result about Polymarket.
