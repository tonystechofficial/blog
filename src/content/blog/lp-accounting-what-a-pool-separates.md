---
title: "What a Uniswap pool separates, and what it never does"
description: "V3 and V4 keep fees apart, V2 folds them into reserves, and none of them separates invested capital, so the fund keeps its own ledger of deposits."
pubDate: 2026-10-02
track: "onchain"
tags: ["uniswap", "lp", "accounting", "evm"]
sources: ["defi/ce-qu-un-pool-separe-frais-principal-et-ce-qu-il-ne-separe-pas-capital.md", "defi/uniswap-v4-montants-a-calculer-depuis-l-etat-du-pool.md", "defi/une-position-lp-detenue-n-est-pas-une-position-creee.md", "defi/prix-par-contrat-la-ou-le-portefeuille-liste-tout.md", "defi/verifier-une-adresse-de-contrat-par-son-code.md", "defi/un-jeton-enveloppe-en-pool-vaut-la-monnaie-de-sa-chaine.md", "defi/mesurer-le-cout-en-gaz-d-une-transaction-l2.md"]
---

## The pool sold 0.4 ETH and called it principal

A client's on-chain fund holds LP positions and settles a withdrawal as "invested amount plus gains", pro rata to the liquidity withdrawn. On 2 October 2026 my first assumption was that the pool already separated gains from capital, so why keep a ledger of deposits at all.

Uniswap V3 keeps fees apart from principal: `tokensOwed` plus fee growth, and a `collect` without `decreaseLiquidity` pays the fees alone. Uniswap V4 keeps them apart too, without storing an owed amount: fees are the pool's fee growth since the last update times the liquidity, paid at any modification. Uniswap V2 does not: fees enter the reserves and an LP's share is a fraction of them. THORChain and Maya keep, per position and per side, the value deposited and the value redeemable (`asset_deposit_value`, `asset_redeem_value`), without distinguishing fees from rebalancing.

None of them separates the invested capital. The "principal" is not what was deposited; it is the liquidity re-expressed at today's price, and a pool continuously sells the token that rises against the one that falls. I measured it that day on a real symmetric position in THORChain's ETH.ETH pool: deposited 1.3365 ETH and 3 065 RUNE, redeemable 0.9319 ETH and 3 222 RUNE. ETH had risen against RUNE and the pool had sold 0.4 ETH. That is neither a fee nor a loss visible in any fee counter; it sits in the principal. Take fees alone as gains and the rebalancing hides in the capital, which comes back smaller at withdrawal with no readable reason. And the cost of each token is not in the pool: to realise only what comes back in stablecoin, you need the cost of every token deposited and of every unit the pool converted, which is the deposit ledger, not the pool's counter. THORChain's `luvi_growth_pct` is no shortcut either: -14 % on a position that had collected fees.

## V4 does not log amounts

Settling a withdrawal needs, for each movement, the position touched, the liquidity moved and the amounts. V3's position manager events and V2's `Mint` and `Burn` carry them. V4 does not. All positions live in one contract, the PoolManager, which emits `ModifyLiquidity(PoolId id, address sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)`: no amount. The `salt` is the position number. ERC-20 legs appear as `Transfer` logs; a native ETH leg is an internal transfer and leaves no log. And V4 pays accumulated fees at every modification, increases included, deducted from the deposit.

So I compute the amounts the way the PoolManager does: the price just before the movement (the `sqrtPriceX96` of the last `Swap` of that pool earlier in the block, otherwise `getSlot0` at the previous block), the principal of `|liquidityDelta|` at that price on the range, rounded up when adding and down when removing, and the fees as the growth of `feeGrowthInsideLast` between the previous block and the movement's block, times the liquidity before, divided by 2^128. Then the guards: the pool key must hash to the logged id, the position must hold after what it held before plus the delta, and each ERC-20 leg must equal the receipt's transfers within 2 units. Otherwise nothing is recorded and the movement waits.

I ran it read-only on four recent mainnet transactions of native-ETH positions: two increases that also paid fees, one fee collect, one withdrawal. The native leg, checked against the sender's balance change plus gas, had 0 wei of difference on the first three, and the ERC-20 legs passed on all four. On the withdrawal the balance diff was off by 0.00095 ETH because the sender had another transaction in the same block; the PoolManager's internal transfer on the explorer was exactly the computed amount, 4 607 313 702 215 320 wei. A balance difference is not a measure; the state is. One more trap: a pool created in the same transaction has no previous-block state and `getSlot0` returns a null price; on Base 13 of 15 mints by one wallet were such token launches, and 12 were refused by the transfer check, the right default.

## A position you hold is not a position you created

V3 positions were enumerated, `balanceOf` then `tokenOfOwnerByIndex` on the position manager, so every position NFT held by the address counted as the fund's. On 11 October, proving the V3 reader on Unichain, a third-party wallet held three positions more than Uniswap displayed: pools between fake dollars, a "USDC" with 18 decimals where the real one has 6, and advertising tokens, which Uniswap hides and an on-chain reader sees. In the fund, one token without a price blocks the closes: anyone could have done that for the price of gas.

The rule: count only the positions the fund's own deposits name, the number recorded at confirmation from the receipt's `IncreaseLiquidity`, `DecreaseLiquidity` and `Collect` events. Check `ownerOf` before reading: transferred or burned, it is no longer the fund's. A deposit that names nothing is unreadable, never zero. Enumeration stays for display, never for counting.

## Price by contract, verify by code, value wrapped as native

Where the balance read lists every ERC-20 an address holds, two shortcuts had given prices without a quote: a stablecoin symbol was worth 1 dollar, and a currency took the CoinGecko price of its symbol. So a token minted under the name "USDC" was worth 1 dollar apiece, and a "WETH" the price of ether. On-chain symbols do not even match token lists: bridged USDC.e reports `USDC`. Since 11 October a symbol gives a price only if the contract is on a list verified on-chain, code, symbol, decimals and supply, and the list says what each contract represents: a bridged dollar is valued as the dollar, whatever its name.

An address is verified by its code, not by its look. On 10 October three tables gave the V3 position manager on Base as `0x03a520b32c04bf3beef7bf5d56e39e92d51752dd`. The first 22 characters are those of the real address, `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1`; the rest was invented. `eth_getCode` returned 0 bytes for the fake and 24 384 for the real one. An EVM call to an address without code succeeds: an `approve` to it "works", a `mint` sent there is a successful transaction that creates nothing, a read returns empty. No error, ever. So each address is checked against the publisher's deployments, by `eth_getCode`, and by the contracts naming each other, `factory()` on the manager for instance; a test compares every table to the verified one, and it found the three copies.

A wrapped token in a pool is valued as the chain's coin. The fund deposits ETH, but an ETH/USDC position holds WETH, which neither the wallet nor the ledgers name, so the price table had no entry for it and the most common deposit blocked closes on every chain where the fund held no WETH. For valuation only, WETH, WBNB, WAVAX or WPOL without a key of its own takes the key and price of the same chain's currency, never another chain's; settlement keeps the token's own key.

## Gas on an L2 is not gasUsed times price

On 12 October the fund wanted each position's yield net of the gas of its own transactions, and the transaction record kept `gasUsed` but neither its price nor the L1 fee. On OP-stack chains such as Base, Optimism and Unichain, the cost is `gasUsed × effectiveGasPrice + l1Fee`, and the L1 fee is often most of it. ethers does not return `l1Fee`, so I read the receipt raw, `eth_getTransactionReceipt` through `provider.send`, and parse the hex fields. Verified to the wei: 3 of 3 against the explorer on Ethereum, 4 of 4 on Base against the balance drop of senders with a single transaction in their block.

## What I keep

- V3 and V4 separate fees from principal, V2 folds them in, and none separates invested capital. That is the deposit ledger's job.
- V4 logs no amounts: compute them from the pool state at the previous block, verify against the ERC-20 transfers, refuse rather than invent.
- Count only the positions your own deposits name, and check `ownerOf`.
- A price comes from a contract, never from a symbol. An address is verified by its code and by the contracts that name it.
- On an L2, read the raw receipt for the L1 fee.
