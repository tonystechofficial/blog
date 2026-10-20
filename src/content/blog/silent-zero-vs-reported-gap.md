---
title: "What you cannot read must become a gap, never a zero"
description: "On a path that computes money, a failed read written as 0 is a wrong number with no signal, so every unreadable source has to surface as a gap."
pubDate: 2026-10-16
track: "onchain"
tags: ["defi", "reliability", "nav", "testing"]
sources: ["defi/comptabilite-lp-d-un-fonds-un-zero-silencieux-contre-un-ecart-signale.md", "securite/panne-de-fournisseur-vs-resultat-vide.md", "defi/un-fournisseur-de-soldes-qui-refuse-sa-cle-doit-etre-un-ecart-pas-un-zero.md", "defi/une-doublure-qui-leve-la-ou-le-vrai-service-avale.md", "defi/un-recu-null-n-est-pas-une-transaction-en-attente.md", "defi/une-cascade-de-repli-doit-s-arreter-sur-un-refus.md"]
---

## Four defects, one shape

On 12 October 2026 the manager of a client's DeFi fund asked me whether the accounting of its LP positions was perfect. The fund holds positions on Uniswap V2, V3 and V4, on PancakeSwap and on THORChain. It counts them in its NAV and shows them on two dashboards. No position existed yet on the client's environment, so everything rested on the code. I audited it, claim by claim, in the code.

Most of it was right: uncollected fees counted, out-of-range positions valued, nothing counted twice. The four defects I found all had the same shape, a wrong number with no signal. Two examples. The daily close, which freezes the day's figures under a fingerprint, wrote "no position, 0 $" when the positions could not be read, and sealed it for ever. A rate limit on an `eth_call` became a `CALL_EXCEPTION` in ethers 6, which the code read as a burned NFT, and the position left the NAV.

Four days later the same shape showed up at a larger scale. Moralis had stopped its legacy free plans on 1 September 2026: the key stays, usage is paused until you subscribe, from about 149 dollars a month, and every call returns 401, for ever. The fund's balance flow still read five chains through Moralis, Polygon, Avalanche, Arbitrum, Optimism and Base, with tolerant calls: the error was swallowed, the method returned `[]`, and each chain looked like an empty wallet. For six weeks, five chains read as zero without a word. The fund held nothing there, so no damage, by luck. The log carried about 45 Moralis lines a minute, two warnings repeated, and it was the client who flagged it, at 28 warnings a minute.

## Why a zero is the worst answer

I had met this pattern on 11 August, on a real valuation path with a revoked API key. The client caught the error and returned `[]`. The neighbouring function caught and returned `{ balance: '0' }`. The aggregator caught per chain, set `[]` for each, and returned its object without throwing. The fallback succeeded with an empty result, and the valuation was 0. Worse: a second provider was configured after that one, and it was never tried, because nothing had thrown.

An investor opens the dashboard and sees an empty fund while the money is there, and the withdrawable amount is computed on that value: an expired key becomes an apparent loss, without one error message.

A zero that was observed and a zero that stands for "I could not read" are identical to everything downstream. On a path that computes a total, a partial result is a wrong number presented as exact. Better to display nothing than to display too little.

## The guard that was dead, and the test that said it was alive

The rule existed in the code since August: a `strict` flag made the balance client throw instead of returning `[]`. On 5 October I read eight hours of staging logs: 2 279 failed token reads and 2 200 failed native balance reads, all 401, and not one line from the `catch` that names a chain unreadable. The reader of the five chains called the client without `strict`, then relied on its own `catch`. That `catch` could never run, because the layer below swallowed everything.

The test that proved the guard simulated the outage with `mockRejectedValue(new Error('401'))`, a double that throws. The real client returns zero. The test was green and said nothing about the real path. In August my first fix had failed the same way: counting failures in the aggregator's per-chain `catch`, a `catch` that never fires. A dead guard you believe is alive is worse than an absent guard: it closes the subject.

## Two more faces of the same defect

A `null` receipt. A Uniswap V4 position is not listed on-chain. The reader finds it through the transaction that created it and reads the receipt on the first node of a list that answers. The original code treated a `null` receipt as "not mined yet, read again next pass". On 11 October I measured that Alchemy without a key, on World Chain, serves state 5 000 000 blocks back and returns `null` for a receipt older than about nine hours. A public Celo node returned `null` for a receipt about three weeks old. Keeping old state and keeping receipts are two distinct retention policies. After a restart, the fund's position was no longer read: absent from the value, without error. A `null` is this node's hole, not a state of the transaction.

A fallback cascade. The backend reads through a list of RPCs and hands the same read to the next one on failure. A Base transaction moved two Uniswap V4 positions at once. Each of the six RPCs read it and refused it with "2 positions moved in one transaction". The cascade kept the last error, and the last RPC, rate limited, had answered "429 Too Many Requests" before reading anything. The log said "V4 amounts not computed, 429". An operator would have waited for the end of an outage that did not exist, while the movement needed a manual settlement. Six full reads for a refusal known from the first.

## The practice

Strict reads on money paths. The client keeps its tolerant mode for best-effort discovery, and the money path asks for the strict one:

```ts
getBalances(address, chain, { strict: true })   // propagates
getBalances(address, chain)                     // returns [], historical behaviour
```

The trigger is "a source failed", never "a source is empty". A wallet that holds nothing is an answer, not an outage.

An unreadable state. A chain whose read fails is marked unreadable and the valuation carries the gap. The daily close now records the day's gaps and writes `null` for the pooled share, which blocks the closes instead of corrupting the NAV. It has a cost: the LP read is all or nothing over 19 chains, so one unreadable chain empties every position from the display, and chain-by-chain valuation is the next job.

A refused key is configuration, not an outage. A 500, a 429 or a timeout are outages worth a retry. A 401 or a 403 pauses the integration for one hour and says so once. Without a key, no call leaves. It is a pure rule, time passed as an argument, tested alone and placed as a single guard. In the log, "key refused, paused until HH:MM" once an hour is the expected state, not an incident. Removing the key from the environment is not enough while the code still calls without a header.

A `null` receipt asks `eth_getTransaction` on the same node. Known without a block: pending, read again later. Unknown: next node. No node has it: unreadable, never zero. And once a transaction is confirmed, the recorder notes the position number so nothing depends on the receipt again.

A cascade stops on a data refusal. I type the refusal where it is decided, in a dedicated error class, and rethrow it as is from the cascade. The reason keeps its words and the cascade stops at the first RPC, in 283 ms instead of six reads. In doubt, it is an outage: an inconsistent state between two blocks can come from a lagging node. I do not guess from error codes; the timeout imposed by my own wrapper is an error without a code.

Verify by mutation. Remove the propagation and watch the test fail. If it stays green, the stub implements `strict` itself. At least one test runs the real client against a transport that returns 401.

## What I keep

- A zero that was observed and a zero for a failed read must never look alike. The criterion is failure, not emptiness.
- A guard inside a `catch` depends on every layer below it. One swallowing layer and it is dead.
- A test double must fail the way the real collaborator fails. Read what the real one does with an error before writing `mockRejectedValue`.
- The living control is in the logs: thousands of errors and no guard line means the guard does not run, whatever the test says.
- A refused key is a fact of configuration. Pause one hour, say it once.
