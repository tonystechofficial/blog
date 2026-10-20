---
title: "A Minima transaction your node calls mined may not be in the chain"
description: "Five provisional inclusions in 67 minutes: on Minima, inclusion is proven by the canonical block that spends the input, not by the first observation."
pubDate: 2026-09-30
track: "minima"
tags: ["minima", "confirmation", "reorg", "txpow"]
sources: ["defi/une-transaction-minima-minee-par-votre-noeud-peut-ne-pas-l-etre.md", "defi/savoir-si-un-noeud-minima-est-sur-la-bonne-chaine.md", "defi/mds-et-rpc-minima-deux-reponses-trompeuses.md", "defi/un-envoi-dont-on-ignore-l-issue-n-est-pas-un-refus.md"]
---

On a client's DeFi platform, a backend posts token sends to Minima with `txnpost`, then confirms them by watching the chain: the input coin has left the unspent set, the change coin has appeared at the pinned address, and its depth (tip minus `created`) has reached 50 blocks. On 30 September 2026, a purchase posted at 11:10 UTC never reached 50. Its depth kept going back to zero.

The confirmation log tells the story. The change coin was "created" at block 2,341,727, depth 1 to 20. Then "input coin unspent, change absent". Then created at 2,341,758, withdrawn, 2,341,761, 2,341,766, 2,341,770, and finally 2,341,776. Same coin id each time (a coin id derives from the transaction), with a `created` that kept changing. The same transaction, included then dropped, five times.

None of the first five blocks carried it on the public chain. A bench seat and an independent node on the same server had the same block hash at each of those heights, and only block 2,341,776 contains a transaction that spends the input coin. Real delay: about 67 minutes.

The healthy case, measured on 4 October 2026 with the bench nodes at the public explorer's height: a purchase posted at 13:25:08 UTC was seen in the chain 82 seconds later (block 2,348,778, depth 1), never moved, and passed CONFIRMED at 50/50 at 14:09:30 UTC. That is 44 minutes 22 seconds, 50 blocks at about 50.5 seconds each.

## Why a node's "mined" is provisional

Minima is a UTXO chain where every node is a full node and every transaction carries its own proof of work, a TxPoW. What one node reports after a post is its current view of the tip, and that view is provisional: a block the node accepted can be superseded, and the coin it showed you disappears with it.

Same height is not same chain, and your nodes agreeing with each other proves nothing. On 29 September 2026, on the test server, the public explorer reported block 2,340,160. The user node was at 2,340,160 with 49 peers. Seats 1, 3 and 4 were at 2,335,971 with 11, 1 and 1 peers. Seat 2 was at 2,324,900 with 0 peers. Seats 1, 3 and 4 agreed block for block, and all three were on a fork. The probable cause, which I did not verify, was a network cut of the host from 22 to 28 September 2026.

What a fork costs: a purchase from 30 September was signed, broadcast, and marked CONFIRMED at 50 blocks by the building node while it was on a fork. Back on the mainnet, nothing existed. The pool's coin was still unspent, the buyer had received nothing, and the database still said CONFIRMED. Depth is measured on the node's own chain.

## Proving inclusion

What decides is the identity of the block at a given height, not the height.

```
txpow block:<height>      →  response.txpowid
```

Two nodes on the same chain return the same `txpowid` for the same height. A different id is another chain, whatever the heights. The purchase marked CONFIRMED on 30 September had recorded one block id at height 2,342,241; on 3 October a node back on the mainnet carried another.

To find the canonical block that carries a transaction:

1. Same chain? Run `txpow block:<h>` on two nodes that do not depend on each other. `response.txpowid` must match.
2. Which block spends the input? For each candidate height, read the block's own transaction (`response.body.txn`) and every listed one (`response.body.txnlist`, then `txpow txpowid:<id>`, then `body.txn.inputs[].coinid`). `txns=0` in `txnlist` does not mean the block carries nothing: it also carries its own `body.txn`.
3. Same method for a deposit. Before paying a sale, a canonical transaction must pay the amount to the pool address.

Two traps. The id returned by `txnpost` is not the id of the mined TxPoW: `txpow txpowid:<posted id>` answers `status: false`. On 4 October 2026 that command answered `TxPoW not found` on all four seats while the transaction had been in the chain for 43 minutes (`txpow onchain:<posted id>` gave `found: false` too). It is the pre-mining id; what a node can find is the block. And on a node that does not follow the address, `coins coinid:<id> relevant:false` finds nothing. That is not proof of absence.

## Knowing the node is on the right chain

Compare to the public explorer, never to neighbours:

```bash
curl -s https://explorer.minima.global/api/stats
# {"topBlock":2340160,"averageBlockTime":"50.26","blocksInLastTwentyFourHours":1719,...}
```

Only `/api/stats` answers, so the external reference is a height; block identity is compared between my own nodes, or against what a confirmation recorded.

On the node, `block` returns the height in milliseconds, where `status` can take over 10 seconds. `status` also gives `network.connected`: 0 means the node mines alone, on its own fork from the first block. Having peers is not enough. Seat 1 had 11 and stayed 4,189 blocks behind: beyond a certain depth a node no longer reorganizes by itself.

The remedy is a chain resync, which asks for no phrase and keeps the wallet:

```
archive action:resync host:<ip:port of an archive node>
```

Measured on seat 1: under two minutes, wallet intact, coins of the tracked scripts found again with the same coin ids. The only loss was coins created before the resync's start block (2,290,495), three NFTs here, no longer listed. They still exist on the chain. `megammrsync` was no option: it only searches the 64 wallet keys, not tracked scripts like the pool address.

The guard I then put in the backend, on 3 October 2026, compares the node's height to the explorer's `topBlock` before broadcasting and before confirming. Within 20 blocks is "on mainnet"; beyond that, behind or ahead, is "off mainnet"; unreadable is "unknown". Both refuse, never "assumed good". Since the reference becomes a single point of failure, I keep the last height obtained and extend it at block rhythm (`averageBlockTime`, about 50 s) for 30 minutes at most. A second guard fails, hence makes replayable, a line broadcast for more than 6 hours whose input no longer exists and whose change never appeared, seen from a mainnet node. At its first pass it closed a purchase stuck for 71 hours. Any doubt fails nothing: a human looks. The same check belongs everywhere the code believes a node, from listing coins to confirming: on 30 September three experts signed a transaction built on a forked coin that the mainnet could not mine.

## An unknown outcome is never a refusal

In a MiniDapp, `MDS.cmd` calls back with `{}` on a network failure, without any `status`. A wrapper that reads "no status" as a failure turns a send the node may have executed into a refusal. A sale dApp re-offered the send and tokens left twice (review of 14 October 2026). There are three outcomes: pending (a read-only node sets the command aside), refused (`status: false` with an error), unknown (`{}`, an exception, a timeout). Only "refused" allows forgetting a send. "Unknown" is checked on the node before any retry: in `history`, a transaction paying that address and amount; in `coins`, the coins noted just before the send.

Server side, the same rule. After `txnpost`, no response or a response without txpowid leaves the line `BROADCAST` without hash, not replayable, and the sweep confirms it from the chain if it left. Only an explicit refusal from the node is `FAILED`, and an error while writing the hash after a successful post must never mark `FAILED`, because `FAILED` is replayable: every post-send error filed there is a deferred double payment. The same holds for an EVM wallet that signs and broadcasts by itself: only a failure before the request, or an explicit user refusal (EIP-1193 code 4001), proves that nothing left.

## What I keep

- Count depth from the last observation, and restart from zero when the coin disappears.
- The proof of inclusion is a canonical block, same `txpowid` on two independent nodes, with a transaction that spends the input coin.
- The id returned by `txnpost` is not the mined TxPoW id. `TxPoW not found` is not "nothing left".
- Compare each node to the public explorer's height, not to its neighbours. `network.connected = 0` is a node mining alone.
- A send with an unknown outcome is checked on the node, never retried. Never pay twice.
