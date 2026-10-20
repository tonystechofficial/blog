---
title: "A private two-node Minima chain as a test bench"
description: "The private-network flags are a property of the process, not of the genesis: drop them once and the peer blacklists you."
pubDate: 2026-09-23
track: "minima"
tags: ["minima", "docker", "test-bench", "h2"]
sources: ["defi/chaine-privee-minima-deux-noeuds-drapeaux.md", "defi/monter-un-env-preprod-dapp-minima.md", "defi/remettre-un-banc-de-test-a-zero-sans-fausses-correspondances.md", "defi/patcher-un-minidapp-a-chaud.md", "defi/h2-de-minima-n-est-pas-mysql-sqlstring-n-echappe-pas.md", "defi/minima-mds-reference.md"]
---

The local test bench for a client's DeFi platform runs two Minima nodes on a private chain, away from the mainnet: an issuer node that creates the genesis, and a user node that attaches to it. In Docker, the issuer starts with `-solo` (equivalent to `-test -nop2p`), which creates the genesis. The user node starts with `-test -nop2p -connect <issuer>:<port>` and joins the existing chain without creating a second one.

Once the genesis exists, the temptation is to remove `-solo` from the issuer service: the genesis is in the database, so the flag "no longer serves". That is false, and the error does not show up where you look for it.

What I measured on 23 September 2026: `-test` also sets the network parameters of the process, and the version the node announces in its greeting. A node started with `-test` presents itself as `1.0.47-TEST`; the same node without the flag presents itself as `1.0.47`. The two refuse to talk:

```
Greeting with Incompatible Version! 1.0.47-TEST .. we are 1.0.47
```

On the calling side the refusal is more explicit, and that is where the trap is:

```
Connected attempt success to <issuer>:9001
Greeting with Incompatible Version! 1.0.47 .. we are 1.0.47-TEST
INVALID PEER added to List! <issuer>:9001
```

Three consequences chain together. The TCP connection succeeds, `docker ps` is green, and the rejection is applicative. The node without the flag has no chain at all: its RPC answers `{"status":false,"error":"NO Blocks yet.."}` and its logs repeat `No tip found in Main Checker..`. And the peer is blacklisted, so reconnection attempts stop. Fixing the flag and restarting the faulty node alone is not enough: the node that blacklisted it will not call back.

## Why the flag is a property of the process

The node's help says it in one line:

```
-solo   Run a solo/private network (-test -nop2p) and will run -genesis ONLY the first time
```

`-solo` carries both network flags at every start and creates the genesis only when the data folder is empty. It is the right permanent flag for the issuer; my first reasoning confused "creates a genesis" with "creates a genesis every time". A node joining a chain it did not issue is different: its data folder is empty, and `-solo` would build it a genesis of its own. That node takes `-test -nop2p` and attaches to its peer.

A flag removed "because its effect is already in the database" is a bet on what the flag really does. The genesis was persistent; the network identity announced at every greeting was not, and it carried the compatibility between the two nodes. If one node keeps `-test` at every start and the other does not, one of them is wrong, even while the bench works until somebody restarts.

## Reattaching without a new genesis

1. Give the faulty node `-test -nop2p`, without `-solo`.
2. Let it call its peer, since the peer will not call back. In RPC: `connect host:<peer>:<port>`. The answer is immediate and the Initial Block Download follows:

   ```
   Connected attempt success to <user>:9011
   [+] Connected to the blockchain Initial Block Download received. size:44.4 KB blocks:34
   Saving Cascade in ARCHIVEDB.. tip : 5007
   ```

3. Check the agreement on the same height and the same tip.

## The chain's treasury lives in one wallet

Restoring the link was not enough. On a private chain, `-genesis` places the entire issuance in the wallet of the node that created it. Losing that node's data does not destroy the chain, it keeps its blocks and its million units, but nobody holds the key anymore. Both nodes then show `coins: 0` with an intact `total`, and the total looks like a balance.

The consequence surfaces far from there. Without a coin, the node refuses `tokencreate`. Minting the identity token fails, and the user sees a generic "service unavailable" screen. The command says it in one word:

```
{"command":"tokencreate","status":false,"error":"No Minima Coins available!"}
```

When a feature that mints something fails, I now check `coins` before anything else, and I do not trust `total`. A lost treasury on a private chain is not recoverable: no faucet, only a new genesis.

## Order of operations for a preprod

A full preprod adds a blank MongoDB, the backend and two MiniDapps to the two nodes, each node being a JVM at about 1.2 GB. The order matters more than the commands: Mongo, then the nodes synchronized (both return the same `chain.block` on `/status`), then the backend, then the dApps built last, because the backend URL is frozen at compile time. The build scripts can inline the production URL by overriding `.env`, so I pass it on the command line (`VITE_API_BASE_URL=… bun run build`).

## Resetting the bench without false matches

On 3 October 2026, after a fork had left orders stuck, I had to reset the bench's database. The temptation is to empty it. A test database holds two things: the history of attempts, which is disposable, and the observations of the chain, which describe a state that still exists after the reset. A sale is matched to any unconsumed pool-coin detection by exact amount, oldest first. Emptying the detection table does not remove the coins: the monitor re-detects them at the next tick, unconsumed. The bench had pool coins of 50, 100, 50 and 100. The next sale of 50 or 100 would have been paid without anything being sent.

The rule: delete the history, keep every observation whose object still exists on the chain. Back up first, inside the container since `mongodump` is not on the host:

```bash
docker exec -e URI="$URI" <mongo> sh -c 'mongodump --uri="$URI" --archive --gzip' > backup.archive.gz
```

Then: coin list read from the chain, a dry run that prints what would be deleted, backend stopped, deletion, restart, re-read through the API. The script refuses a coin at the pool without a detection line.

## Hot-patching a MiniDapp

A MiniDapp lives in `<data>/1.0/mds/web/<uid>/`, with its H2 database in `<data>/1.0/mds/data/<uid>/sql/sqldb.mv.db`. Writing into the web folder is not enough: MDS keeps the script loaded in memory. Repackage the folder's content (not the parent folder) as a zip, then reload it with the same uid, which is what preserves the database:

```bash
cd /tmp/build && zip -qr /tmp/patch.mdz .
curl -sk -u minima:<RPC_PASSWORD> \
  "https://127.0.0.1:<MDS_PORT>/mds%20action:update%20uid:<uid>%20file:<basefolder>/patch.mdz"
```

The command goes in the URL path, spaces encoded. `uninstall` plus `install` creates a new uid and abandons the data folder. The reload has about 3 minutes of latency, so I wait at least 5 before concluding, and the only proof that the new code runs is a log line it emits, read with `journalctl -u minima -f | grep --line-buffered PATCH`. One more effect, measured twice: an update kills the sessions of pages already open. The node logs `MDS Invalid SessionID Exception`, and the tab keeps the old code. Do not update a MiniDapp while someone is testing it.

## H2 is not MySQL

A MiniDapp stores local data through `MDS.sql(...)` in its own H2 database. The user dApp escaped its values with `sqlstring.escape()`, a package written for MySQL. In standard SQL, hence in H2, the apostrophe is escaped by doubling it (`''`) and the backslash is an ordinary character. So `x'; DROP TABLE data; --` becomes `'x\'; DROP TABLE data; --'`, which H2 reads as the string `x\` followed by a second statement, executed. And `{"a":1}` becomes `'{\"a\":1}'`, stored as is, which `JSON.parse` refuses. Measured on 19 October 2026: the local registry of sale sends became unreadable at its first write and never healed.

The fix is `'` + `value.replace(/'/g, "''")` + `'`, with numbers, booleans and `null` as literals and everything else refused. The tests that split literals MySQL-style (`'(?:\\.|[^'\\])*'`) validated exactly the defect; a test must read literals like the target engine, `'(?:''|[^'])*'` for H2.

## What I keep

- Private-network flags are passed at every start: `-solo` for the issuer, `-test -nop2p -connect` for the others.
- A blacklisted peer does not call back. Fix the flag, then make the faulty node call.
- The treasury is in the issuer's wallet. When minting fails, read `coins`, not `total`.
- Reset the history, keep the chain observations, or the next match pays for nothing.
- `mds action:update` with the same uid keeps the database. Name the SQL engine before choosing an escape.
