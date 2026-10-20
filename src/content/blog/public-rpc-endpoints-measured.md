---
title: "Public RPC endpoints, measured before trusted"
description: "Most well-known public RPC endpoints are dead or fail inside an HTTP 200, so I probe every read my code makes, from every server that will make it."
pubDate: 2026-10-11
track: "onchain"
tags: ["rpc", "evm", "resilience", "thorchain"]
sources: ["defi/rpc-publics-ethereum-sondage.md", "defi/rpc-publics-base-sondage.md", "defi/quand-aucun-noeud-public-ne-sert-tout.md", "defi/noeuds-publics-thorchain-maya-sondage.md", "defi/le-portefeuille-signe-et-rien-d-autre.md"]
---

## Three dead entries out of five, two of them in HTTP 200

On 3 August 2026 I probed the five public Ethereum endpoints that a fallback list copied from a tutorial usually contains. publicnode and drpc answered. cloudflare-eth.com answered HTTP 200 with `{"error":"Cannot fulfill request"}` in the body. rpc.ankr.com/eth answered 200 with `-32000 Unauthorized`: an API key is now required. eth.llamarpc.com returned 521. Three out of five unusable, and two of the three failed inside an HTTP 200. A health check that reads the status code believes them healthy.

Two months later the picture was the same from a browser, and eth.llamarpc.com was still the hard-coded RPC of a deposit screen in the expert dApp of a client's DeFi platform.

A dead entry is not neutral: it costs one attempt at every failover. On 6 October every Sepolia read from the backend, which tries three RPCs, came back "not measured" after 6.3 seconds: the first three entries were dead, the two live ones sat fourth and sixth. With the live ones at the head, pinned by a blacklist test, the same read took 65 to 85 ms. A cascade with N attempts is worth its first N entries.

## Archive is a separate capability

On 2 October, from the staging container, I measured the endpoints at `latest`, 50 000 blocks back and 500 000 blocks back. publicnode served `latest` in 59 ms and answered 403 to the old block: "Archive requests require a personal token". drpc, nodies and mevblocker served both. Alchemy, with the project's key, answered 429, "Monthly capacity limit exceeded". cloudflare-eth.com found a third way to fail inside a 200, "Internal error".

The LP reader cut its Ethereum pool at three attempts, and its first three entries were dead, without archive, dead: one live node and none for an old block, while a Uniswap V4 movement is measured on the pool state before its block. A node that serves `latest` in 59 ms and refuses 50 000 blocks back passes every usual health check.

The probe is short, and the criterion is the presence of `result`, never the HTTP code:

```bash
for u in https://ethereum-rpc.publicnode.com https://eth.drpc.org \
         https://cloudflare-eth.com https://rpc.ankr.com/eth https://eth.llamarpc.com; do
  r=$(curl -s -m 10 -X POST "$u" -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}')
  echo "$r" | grep -q '"result"' && echo "OK $u" || echo "KO $u: $r"
done
```

## The seven reads a position valuation needs

On 11 October the fund added Base. Current-state reads worked through the chain's public batch, but the amounts of a V4 movement come from the pool state at the previous block, and the batch, publicnode, mainnet.base.org and Tenderly, could not compute a single one: 429 Too Many Requests.

So I listed the reads the valuation makes and probed each with the production client, ethers v6, one attempt per URL: the block height; the receipt of a real V4 mint; the logs of a block; `getSlot0` at the block before that mint; four reads launched together, which ethers sends as one JSON-RPC batch, as the amount computation does; the state 500 000 blocks back; the state 5 000 000 blocks back.

Of 23 keyless Base nodes, three passed everything from both servers: blastapi, with `eth_getLogs` capped at 10 blocks, and the two nodies endpoints. drpc returned 500 on a batch. publicnode returned the head and 403 to receipts and old state. Tenderly answered 429 from the staging server and all green from the other one: limits are per IP, so I probe from every machine that will read. And the error message can lie about the limit: drpc refused 500 blocks of logs while talking about 10 000. Measure the range, do not read it.

## When no node serves everything

BNB Chain, same day. blastapi kept state 5 000 000 blocks back and answered 429 to every `eth_getLogs`. 48.club and bloXroute served logs in 5 000-block ranges and failed on state from the previous block with "missing revert data". Together the nodes served everything; none served both halves. The backend read everything on one node before moving to the next, so a V4 movement was never computed.

The fix is to split the read by capability. Phase A is what the transaction says: the receipt and the logs of its block. Phase B is the state around it: state reads only, batched. Each phase walks the list and takes the first node that serves it. The probe runs per phase, with the calls the code makes: a batch containing an `eth_getLogs` fails on blastapi, the same batch without logs passes. An old-state read is not measured with a balance either: Avalanche's official node returns `eth_getBalance` 500 000 blocks back and takes over 10 seconds for an `eth_call` 5 000 000 blocks back, so the probe makes a dated `eth_call`.

Keeping old state and keeping old receipts are separate policies too: Alchemy without a key, on World Chain, served state 5 000 000 blocks back and `null` for a receipt about nine hours old. And heavy probing from your own servers spends their credit: after an hour of probing, Avalanche's official node answered 429 to a single call from the staging server, so I probe slowly, from a machine nothing will depend on.

## One source, and an alert

THORChain and Maya offer no list at all. On 2 October I tried 14 THORNode hosts, 5 Midgard and 6 MAYANode. The Nine Realms hosts no longer resolve. One free THORNode answered, the Liquify gateway; one Midgard, Liquify again; one MAYANode, the Maya team's. Then five weeks of logs from the test server, from 24 August: 25 796 lines naming the Liquify gateway, zero 429 or rate limit, about 430 to 500 calls a day, one outage of five minutes on 27 August. The decision was one free source plus an alert: an LP read unreadable for 15 minutes sends an email and a notification to the expert, and a message on return. Paid access only if it falls. A backup list of dead hosts would cost an attempt per failover and protect nothing.

## Reads through your own provider, the wallet only signs

On 7 October a Uniswap V3 deposit, WBTC/WETH through Vultisig, failed at Confirm after both approvals had passed:

```
missing revert data in call exception; Transaction reverted without a reason string
(data="0x", transaction={"to":"0x2260FAC5…C599","data":"0x313ce567"}, error={"code":-32603},
code=CALL_EXCEPTION, version=providers/5.8.0)
```

It reads like a reverted transaction. It is not. The `transaction` has no `from`, no gas, no value, and four bytes of data: an `eth_call`. The selector `0x313ce567` is `decimals()` and `to` is WBTC. `data="0x"` with error code -32603 means the wallet's RPC answered "Internal error", and ethers v5 translates an empty answer into "missing revert data". `decimals()` on WBTC cannot revert. The approvals had gone through the app's signing path, with gas and fees measured by the backend. The deposit did everything through the wallet's RPC: reads, gas estimation, `getFeeData`, internal approvals, send and `tx.wait()`.

The rule I keep: from the wallet, take the account and the signature, nothing else. Every read goes through my own provider on the target chain, every transaction through one signing path, each confirmed before the next. The test is a fake EIP-1193 wallet that answers `eth_accounts` and `eth_chainId` and fails everything else with `{ code: -32603, message: 'Internal error' }`; before the fix it returned the client's error word for word. A single public endpoint is no better than a wallet's RPC: on 10 October a user's antivirus closed the connection to publicnode and answered in its place, and ethers reported a `CALL_EXCEPTION` on a plain `balanceOf`. A read that counts goes through a dedicated backend route, on our own domain and providers. The public cascade is display comfort.

## What I keep

- The HTTP status says nothing. Read the body for `result`, and date the probe.
- Probe each read the code makes, as the code makes it, batched when it batches, from every server that will read.
- Archive state, old receipts and wide logs are three separate retention policies. Probe each with a truly old block.
- When no node serves everything, split the read by capability and take the first node per phase.
- One live source with an alert beats a list of dead fallbacks. The wallet signs, and nothing else.
