---
title: "What a Claude Code session really costs, measured"
description: "Cache reads make up about 96 percent of a session's bill and output about 1.5 percent, measured in the transcript and confirmed through OpenTelemetry."
pubDate: 2026-08-24
track: "ai-engineering"
tags: ["claude-code", "cost", "opentelemetry", "observability"]
sources: ["claude-code/mesurer-le-cout-reel-d-une-session.md", "claude-code/travailler-sous-contrainte-de-quota.md", "observability/02-otel-data-catalog.md", "observability/04-otel-resources-sizing.md", "observability/06-otel-client-env-reference.md"]
---

## 71 lines for 33 calls

On August 24, 2026 I wanted the real cost of one session, not an estimate. Every session writes a transcript, one JSON object per line, under `~/.claude/projects/<project-slug>/<session-id>.jsonl`. Each `type: "assistant"` line carries a `message.usage` object with four counters: `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` and `output_tokens`.

The trap is that the transcript writes one entry per content block, not per API call. A turn with text and two tool calls gives three lines with the same `usage` object, and summing naively doubles or triples the bill. On that session: 71 assistant lines, 38 of them duplicates, for 33 real calls. The fix is to deduplicate on `message.id` before summing:

```js
const byId = new Map()
for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
  const o = JSON.parse(l)
  const u = o?.message?.usage
  if (o.type !== "assistant" || !u || byId.has(o.message.id)) continue
  byId.set(o.message.id, u)
}
```

With the 33 calls deduplicated (Opus 5, 1M context), at the prices I used that day (input $5 per million tokens, output $25, cache write at 1.25 times input, cache read at 0.1 times), the bill looked like this:

| item | tokens | share of cost |
|---|---|---|
| cache read | 2 396 569 | ~96 % |
| cache write | 99 792 | ~2.5 % |
| output | 26 604 | ~1.5 % |
| fresh input | 66 | ~0 % |

I almost do not pay for what the agent writes; I pay for making it reread the whole context on every turn. The number of turns and the size of the context they drag along is the bill.

## Why the cache is the bill

A prompt cache serves the unchanged prefix of a conversation at a fraction of the input price instead of recomputing it. In an agent loop the prefix is the entire history, and every turn sends it again. Two consequences, measured on the same transcript.

Every background task notification is a full turn. A monitor that reports events costs, per event, the whole context reread plus a few hundred output tokens: about 87 000 tokens and about $0.054 per event, and the context grows at every turn. At 20 events an hour, a chatty monitor costs about $1.10 an hour and produces nothing. So a monitor filter only reports what I can act on: a block, an error, the end of a run.

Loading a skill inflates every following turn. A skill loaded mid-session adds its content to the context permanently: +35 400 tokens from one turn to the next, about $0.018 more on each remaining turn, around $0.90 on a session with 50 turns still to go. So I load it late, when few turns remain, rather than skipping it.

## The same anatomy at dashboard scale

Through OpenTelemetry, a Grafana dashboard gives the same anatomy across sessions. Reading of August 29, 2026, 8 sessions, 2 350 API requests: $864.20, 1.86 M output tokens, 182 K fresh input, 593 M cache reads. At the Fable 5 prices of that day:

| item | volume | price | cost |
|---|---|---|---|
| cache read | 593 M | $1.00 / M | $593.00 |
| cache write | ~14 M (not displayed) | $12.50 / M | ~$176 |
| output | 1.86 M | $50.00 / M | $93.00 |
| fresh input | 182 K | $10.00 / M | $1.82 |

Cache is 89 percent. Derived marks: about $108 per session, about $0.37 per API request. Without any cache, the 593 M reads at full input price would have cost $5 930.

At other models' prices of that day, token for token, the same volumes would cost about half on Opus 5, a fifth on Sonnet 5, a tenth on Haiku 4.5, and anywhere between $12 and $92 on GLM-5.3-Flash, the whole range coming from its unknown discount on cache reads. But that comparison is a fiction. A model weaker at agentic work takes more turns for the same result. The unit that decides is the cost per finished task: five representative tasks, both models, compare the tasks completed. Routing per task with the `PreModelSwitch` hook beats a global swap.

## Where the time goes

On October 12, 2026 I asked a different question: how to work faster. Twelve sessions, 249 MB of transcripts, 545 turns, about 70 hours of agent work. The latency of a call is the timestamp of its last line minus the event before it; its context is `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. Median latency climbed with context, from 6.9 s under 100 k tokens to 12.7 s over 700 k.

That reading misleads: it does not control for response length. In large contexts the model wrote twice as much (546 then 1 080 output tokens in median), and writing is what costs time. A regression `latency = a + b·context + c·output` gives +0.10 s per 100 k tokens of context and +9.4 s per thousand tokens written. Context is paid in tokens, not in time.

Replayed with the context cleared at every task (`/clear`), counting 25 k tokens per task to reread what is lost: the real run processed 4.57 billion tokens with 18 compactions; one task per message would process 1.7 to 1.9 billion, 59 to 63 percent less, and a prudent cut, a new task after each 30-minute pause, 2.0 to 2.2 billion, 52 to 56 percent less, for about 0.7 to 0.8 hours saved out of 43. Since cache reads are 89 to 96 percent of the bill, the bill or the quota drops by about as much, and no compaction happens.

## Seeing it through OpenTelemetry

OpenTelemetry is the vendor-neutral standard for emitting metrics, logs and traces, and Claude Code emits all three. With `OTEL_METRICS_EXPORTER=otlp` it sends metadata-only metrics, among them `claude_code.token.usage`, `claude_code.cost.usage`, `claude_code.session.count` and `claude_code.active_time.total`. The content flags, `OTEL_LOG_USER_PROMPTS` through `OTEL_LOG_RAW_API_BODIES`, are opt-in and put real text, secrets included, into the backend.

The client side is a block of environment variables, consumption-only profile:

```bash
CLAUDE_CODE_ENABLE_TELEMETRY=1
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.<domain>
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64 user:pass>
OTEL_RESOURCE_ATTRIBUTES=device=<machine-name>
```

The backend is a self-hosted LGTM stack: the `grafana/otel-lgtm` image packs Grafana, Prometheus, Loki and Tempo in a single container, which I run as a Compose service on Dokploy, behind Traefik with a Let's Encrypt certificate. Sizing by profile:

| profile | RAM | vCPU | disk | retention |
|---|---|---|---|---|
| metrics only | 1 to 2 GB | 1 | 5 to 10 GB | 30 d |
| + events without content | 2 GB | 1 to 2 | 10 to 20 GB | 14 to 30 d |
| + content + traces | 3 to 4 GB | 2 | 40+ GB, grows fast | 14 d |

Minimum viable is a 2 GB, 1 vCPU, 20 GB SSD VPS. Retention is the first disk lever; not logging content is the second.

## Working under quota

When the constraint is the quota rather than the bill, the limits recharge on a sliding window: an overrun costs hours of waiting, not the project. `/usage` gives the real state and the recharge time, so I look at it before rationing anything. Then I sequence instead of rationing: tasks split into zero-cost (calls, meetings, decisions, reading) and token-cost (writing and debugging code), and I keep a non-empty queue of zero-cost tasks to switch to when the quota falls.

What empties a quota is almost never the code produced. Three leaks, by return: a reference document too big (a 77 KB project plan is about 25 000 tokens reloaded every session; extract a few-kilobyte `CLAUDE.md` instead), exploration loops (deployment and configuration debugging costs far more than features; a prior specification session turns the next ones into execution), and scaffolding delegated to the agent (copy-paste from documentation, free when I do it myself).

## What I keep

- Deduplicate on `message.id` before summing a transcript, or the bill doubles.
- Cache reads are 89 to 96 percent of the cost. Turns and context size are the bill, not response length.
- Every background notification is a full turn; a loaded skill taxes every turn after it.
- Context costs tokens, not time: 0.1 s per 100 k. `/clear` per task saves 52 to 63 percent of tokens.
- Compare models by cost per finished task, never token for token.
