---
title: "A 3-of-5 multisig on Minima, signed node by node"
description: "The quorum lives in the coin's script: the backend builds without a key, each holder signs on their own node, and txncheck counts."
pubDate: 2026-09-30
track: "minima"
tags: ["minima", "multisig", "custody", "wots"]
sources: ["defi/quorum-minima-multisig-signe-noeud-par-noeud.md", "defi/verifier-une-transaction-de-pool-sur-son-propre-noeud-avant-de-signer.md", "defi/deverrouiller-pour-signer-porte-unique.md", "defi/preuve-detention-nft-noeud-minima-session.md", "defi/adresse-minima-la-casse-de-la-cle-change-l-adresse.md", "defi/restaurer-un-noeud-minima-marge-de-cles.md", "defi/declencher-l-entretien-sur-le-compteur-pas-le-calendrier.md"]
---

On a client's DeFi platform, a dApp sells a Minima token against USDT. The tokens leave a pool whose script is `RETURN MULTISIG(3 k1 k2 k3 k4 k5)`: only 3 of the 5 experts' public keys can spend it. Until 30 September 2026 the circuit also required three `personal_sign` attestations from EVM wallets, which proved nothing about the chain that holds the funds. Since that day the quorum is the chain's, verified by the backend itself.

How a transaction leaves after 3 signatures out of 5:

1. Build without a key, on the pool's node: `txncreate id:X`, `txninput coinid:…`, `txnoutput` to the buyer and the change pinned to the pool address, `txnbasics`, `txncheck`, and `txnexport id:X` gives a hex.
2. Sign node by node, each expert on their own node: `txnimport id:X data:<hex>`, `txnsign id:X publickey:<their pool key>`, `txnexport id:X`, hex back to the backend. The accumulation is sequential: each hex contains the previous signatures, only the last one is complete.
3. Count on the pool's node: each submitted hex is imported under a disposable id, then `txncheck` returns `valid.signatures[{publickey, valid}]`, `allsignaturesvalid`, `signatures` and `valid.scripts`, true only when M valid signatures from the script's keys are present. The backend compares the keys to the pool script and refuses a foreign key, a stale hex, or two keys at once.
4. Post. The signature that closes the quorum posts in the same call, `txnpost id:X` without `auto:` (with `auto:true` the TxPoW is refused: "Burn with non unique CoinIDs"). Measured on 30 September 2026: 63 ms between the third signature and the post, mined at block 2,341,727, change back in the pool.

Rehearsed on a private network of seven disposable nodes, one thing surprised me: `txnpost` answers `status: true` at one and at two signatures, and the transaction is never mined. The check before sending is `txncheck` and `valid.scripts`; the proof after is the coin that moved.

## The quorum is in the script, not in the database

On Minima the "contract" is the address itself, the hash of the script. Only the building node needs to know it (`newscript trackall:true`) to join script and proofs in `txnbasics`; the signing nodes only need their key. Each holder can compute the pool address on their own node with `runscript script:"RETURN MULTISIG(3 k1 … k5)"`, which returns `clean.mxaddress` without recording anything, and compare before a single token moves.

Two consequences for anyone depositing funds. The script is frozen in the address: changing a key or the threshold means a new address, and moving the funds there with 3 of the 5 old keys. And there is no recovery key: three keys lost and the pool is blocked forever.

So changing the threshold means migrating the pool. Writing a new M in the configuration changes nothing: the chain keeps requiring the old one, and the backend refuses any purchase whose M-of-N differs from the script. The migration, specified on 12 October 2026: compute the new address with `runscript`, register it with `newscript trackall:true` where the pool must be seen, suspend deliveries until nothing is in signature, move all tokens to the new address in one transaction signed under the quorum in force, and once it is final at 50 blocks, switch the address and the M-of-N in one configuration activation. A parameter the chain enforces is changed by moving the funds under the new rule; the database follows.

## Verify on your own node before signing

A review on 14 October 2026 found the expert dApp's pre-signature check satisfied by construction: the "expected outputs" came from the same package as the transaction, and the script was displayed without being tied to the paid address. A compromised backend could display `MULTISIG(3 <the DAO's keys>)`, pay its own address, and collect three signatures on the entire pool.

The fix binds everything to the signer's node: it computes the address of the displayed script (`runscript`, `clean.mxaddress`), which must equal the output address as the node decoded the transaction, not as the server describes it; token and amount are read from that decode (`txnlist` after `txnimport`); M and the keys are compared to the proposal two experts confirmed, and the expert must recognize the agreed keys. When a proof is missing, signing stays disabled. The limit: a backend that also controls the governance configuration can make everything agree on keys of its choosing, and only the expert's eyes stop that.

## One gate to unlock, sign, re-lock

A node that signs needs its private keys in clear on disk; a node that holds funds should not leave them there. So the node stays locked and opens for one signature. That looks like "a modal asking for the password", and the modal is the easy part. The unit I code is a single gate, a function that takes the command to run:

```js
const signature = await withVaultOpen({
  reason: 'send',
  run: (cmd) => cmd(`sign data:… publickey:…`),
});
```

The caller never sees the password, the lock state or the window. Six properties, each with a test I saw red first: one pass-through point, kept by a test that fails on any signing command outside the gate's folder; all network calls before the window, which holds only unlock, command, re-lock; refusal, not queueing, for a concurrent call; a persistent flag set before the unlock and cleared after the re-lock, since `finally` does not survive a closed tab; the password in a ref, never in state; and a charset check, since a space inside a command string truncates it silently.

On 14 October 2026 a tester hit the other failure mode: the login went through the gate, but the proof of the 64 wallet keys, written separately, signed directly and answered "your keys are locked". Every function that signs goes through the same gate; for a series, open once, sign everything, close in a `finally`.

A session helps only if it exempts from re-signing, not from proving: of the six login steps, only signing the nonce needs the key, so renewal replays `coins` and `coinexport` and the backend checks with `coincheck`, bound to the public key in the token; a transferred NFT fails it at once. The effective lifetime is the minimum of three bounds: the signed TTL, the client storage (a 30-day token in `sessionStorage` dies with the tab), and the real cadence of re-proofs, which was zero: the renewal endpoint had no client caller.

## Keys, case and counters

On 15 October 2026 a holder with 657 test tokens in five coins read "not counted yet", and the backend logged `coins=0 counted=0 addresses=64` with 64 keys proven. Minima computes a script's address from its text, and the node writes `RETURN SIGNEDBY(0xABCD…)` with the key in uppercase hex. The backend stored keys in lowercase and derived `RETURN SIGNEDBY(0xabcd…)`: another address, empty, 64 times. Two `newscript` commands settled it in ten minutes. Normalizing to compare is not normalizing to compute. Derive from the uppercase key, always.

Minima signatures are stateful (WOTS): a key that signs twice at the same index leaks its private material, and a backup freezes a counter the node keeps advancing. `restore` adds a hardcoded margin of 256 to the stored `uses` (`UPDATE keys SET uses=uses+?`, a margin, not an absolute position). `restoresync` exposes it as `keyuses:`, but with `host:` and a backup older than 2 days it resyncs first and returns without the margin when the archive node is unreachable. So: `restoresync` without `host:`.

A backup is safe while it lags fewer than 256 signatures on the most used key, so I remind at a gap of 200, taking the maximum across keys (one `sign` moves exactly one key from `uses:0` to `uses:1`). At the 257th signature nothing happens on the node; the damage shows only on the day of the restore.

## What I keep

- The backend builds without a key, each holder signs on their own node, and `txncheck` counts: `valid.scripts` is true only at M.
- `txnpost` returning `status: true` proves nothing. The coin that moved does.
- A threshold lives in the script. Changing it is a migration of the pool, never a database edit.
- Before signing, let your own node bind the script to the paid address and read the outputs; refuse when a proof is missing.
- Uppercase keys to derive addresses. Count signatures, not months, to decide when to back up.
