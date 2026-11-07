---
title: "Ce qu'un pool Uniswap sépare, et ce qu'il ne sépare jamais"
description: "V3 et V4 gardent les frais à part, V2 les fond dans les réserves, et aucun ne sépare le capital investi : le fonds tient donc son propre registre des dépôts."
pubDate: 2026-10-02
track: "onchain"
tags: ["uniswap", "lp", "accounting", "evm"]
sources: ["defi/ce-qu-un-pool-separe-frais-principal-et-ce-qu-il-ne-separe-pas-capital.md", "defi/uniswap-v4-montants-a-calculer-depuis-l-etat-du-pool.md", "defi/une-position-lp-detenue-n-est-pas-une-position-creee.md", "defi/prix-par-contrat-la-ou-le-portefeuille-liste-tout.md", "defi/verifier-une-adresse-de-contrat-par-son-code.md", "defi/un-jeton-enveloppe-en-pool-vaut-la-monnaie-de-sa-chaine.md", "defi/mesurer-le-cout-en-gaz-d-une-transaction-l2.md"]
---

## Le pool a vendu 0,4 ETH et l'a appelé principal

Le fonds on-chain d'un client détient des positions LP et règle un retrait comme « montant investi plus gains », au prorata de la liquidité retirée. Le 2 octobre 2026, ma première hypothèse était que le pool séparait déjà les gains du capital, alors pourquoi tenir un registre des dépôts.

Uniswap V3 garde les frais à part du principal : `tokensOwed` plus la croissance des frais, et un `collect` sans `decreaseLiquidity` paie les frais seuls. Uniswap V4 les garde à part aussi, sans stocker de montant dû : les frais sont la croissance des frais du pool depuis la dernière mise à jour multipliée par la liquidité, payés à toute modification. Uniswap V2 ne le fait pas : les frais entrent dans les réserves et la part d'un LP en est une fraction. THORChain et Maya gardent, par position et par côté, la valeur déposée et la valeur remboursable (`asset_deposit_value`, `asset_redeem_value`), sans distinguer les frais du rééquilibrage.

Aucun ne sépare le capital investi. Le « principal » n'est pas ce qui a été déposé ; c'est la liquidité réexprimée au prix du jour, et un pool vend en continu le jeton qui monte contre celui qui baisse. Je l'ai mesuré ce jour-là sur une vraie position symétrique dans le pool ETH.ETH de THORChain : déposé 1,3365 ETH et 3 065 RUNE, remboursable 0,9319 ETH et 3 222 RUNE. L'ETH avait monté face au RUNE et le pool avait vendu 0,4 ETH. Ce n'est ni un frais ni une perte visible dans un compteur de frais ; cela se loge dans le principal. Si l'on prend les frais seuls pour des gains, le rééquilibrage se cache dans le capital, qui revient plus petit au retrait sans raison lisible. Et le coût de chaque jeton n'est pas dans le pool : pour ne réaliser que ce qui revient en stablecoin, il faut le coût de chaque jeton déposé et de chaque unité que le pool a convertie, ce qui est le registre des dépôts, pas le compteur du pool. Le `luvi_growth_pct` de THORChain n'est pas un raccourci non plus : -14 % sur une position qui avait collecté des frais.

## V4 ne journalise pas les montants

Régler un retrait demande, pour chaque mouvement, la position touchée, la liquidité déplacée et les montants. Les événements du position manager de V3 et les `Mint` et `Burn` de V2 les portent. V4 non. Toutes les positions vivent dans un seul contrat, le PoolManager, qui émet `ModifyLiquidity(PoolId id, address sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)` : aucun montant. Le `salt` est le numéro de position. Les jambes ERC-20 apparaissent comme des logs `Transfer` ; une jambe en ETH natif est un transfert interne et ne laisse aucun log. Et V4 paie les frais accumulés à chaque modification, augmentations comprises, déduits du dépôt.

Je calcule donc les montants comme le fait le PoolManager : le prix juste avant le mouvement (le `sqrtPriceX96` du dernier `Swap` de ce pool plus tôt dans le bloc, sinon `getSlot0` au bloc précédent), le principal de `|liquidityDelta|` à ce prix sur la plage, arrondi vers le haut à l'ajout et vers le bas au retrait, et les frais comme la croissance de `feeGrowthInsideLast` entre le bloc précédent et le bloc du mouvement, multipliée par la liquidité d'avant, divisée par 2^128. Puis les garde-fous : la clé du pool doit hasher vers l'identifiant journalisé, la position doit détenir après ce qu'elle détenait avant plus le delta, et chaque jambe ERC-20 doit égaler les transferts du reçu à 2 unités près. Sinon rien n'est enregistré et le mouvement attend.

Je l'ai exécuté en lecture seule sur quatre transactions récentes du mainnet portant sur des positions en ETH natif : deux augmentations qui payaient aussi des frais, une collecte de frais, un retrait. La jambe native, vérifiée contre la variation de solde de l'expéditeur plus le gaz, avait 0 wei d'écart sur les trois premières, et les jambes ERC-20 ont passé sur les quatre. Sur le retrait, la différence de solde était fausse de 0,00095 ETH parce que l'expéditeur avait une autre transaction dans le même bloc ; le transfert interne du PoolManager sur l'explorateur était exactement le montant calculé, 4 607 313 702 215 320 wei. Une différence de solde n'est pas une mesure ; l'état, si. Un piège de plus : un pool créé dans la même transaction n'a pas d'état au bloc précédent et `getSlot0` renvoie un prix nul ; sur Base, 13 des 15 mints d'un portefeuille étaient de tels lancements de jetons, et 12 ont été refusés par le contrôle des transferts, ce qui est le bon comportement par défaut.

## Une position détenue n'est pas une position créée

Les positions V3 étaient énumérées, `balanceOf` puis `tokenOfOwnerByIndex` sur le position manager, si bien que chaque NFT de position détenu par l'adresse comptait comme celui du fonds. Le 11 octobre, en prouvant le lecteur V3 sur Unichain, un portefeuille tiers détenait trois positions de plus que ce qu'Uniswap affichait : des pools entre faux dollars, un « USDC » à 18 décimales là où le vrai en a 6, et des jetons publicitaires, qu'Uniswap masque et qu'un lecteur on-chain voit. Dans le fonds, un seul jeton sans prix bloque les clôtures : n'importe qui aurait pu le faire pour le prix du gaz.

La règle : ne compter que les positions que les propres dépôts du fonds nomment, le numéro enregistré à la confirmation à partir des événements `IncreaseLiquidity`, `DecreaseLiquidity` et `Collect` du reçu. Vérifier `ownerOf` avant de lire : transférée ou brûlée, elle n'est plus celle du fonds. Un dépôt qui ne nomme rien est illisible, jamais nul. L'énumération reste pour l'affichage, jamais pour le comptage.

## Prix par contrat, vérification par le code, valeur enveloppée en natif

Là où la lecture des soldes liste tous les ERC-20 qu'une adresse détient, deux raccourcis avaient donné des prix sans cotation : un symbole de stablecoin valait 1 dollar, et une devise prenait le prix CoinGecko de son symbole. Un jeton frappé sous le nom « USDC » valait donc 1 dollar pièce, et un « WETH » le prix de l'ether. Les symboles on-chain ne correspondent même pas aux listes de jetons : l'USDC.e ponté se déclare `USDC`. Depuis le 11 octobre, un symbole ne donne un prix que si le contrat figure sur une liste vérifiée on-chain, code, symbole, décimales et offre, et la liste dit ce que chaque contrat représente : un dollar ponté est valorisé comme le dollar, quel que soit son nom.

Une adresse se vérifie par son code, pas par son apparence. Le 10 octobre, trois tables donnaient le position manager V3 sur Base comme `0x03a520b32c04bf3beef7bf5d56e39e92d51752dd`. Les 22 premiers caractères sont ceux de la vraie adresse, `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1` ; le reste était inventé. `eth_getCode` a renvoyé 0 octet pour la fausse et 24 384 pour la vraie. Un appel EVM vers une adresse sans code réussit : un `approve` vers elle « marche », un `mint` envoyé là est une transaction réussie qui ne crée rien, une lecture renvoie du vide. Aucune erreur, jamais. Chaque adresse est donc vérifiée contre les déploiements de l'éditeur, par `eth_getCode`, et par les contrats qui se nomment entre eux, `factory()` sur le manager par exemple ; un test compare chaque table à la table vérifiée, et il a trouvé les trois copies.

Un jeton enveloppé dans un pool est valorisé comme la monnaie de la chaîne. Le fonds dépose de l'ETH, mais une position ETH/USDC détient du WETH, que ni le portefeuille ni les registres ne nomment, si bien que la table de prix n'avait pas d'entrée pour lui et que le dépôt le plus courant bloquait les clôtures sur toutes les chaînes où le fonds ne détenait pas de WETH. Pour la valorisation seulement, WETH, WBNB, WAVAX ou WPOL sans clé propre prend la clé et le prix de la monnaie de la même chaîne, jamais d'une autre chaîne ; le règlement garde la clé propre du jeton.

## Le gaz sur un L2 n'est pas gasUsed fois le prix

Le 12 octobre, le fonds voulait le rendement de chaque position net du gaz de ses propres transactions, et l'enregistrement des transactions gardait `gasUsed` mais ni son prix ni les frais L1. Sur les chaînes OP-stack comme Base, Optimism et Unichain, le coût est `gasUsed × effectiveGasPrice + l1Fee`, et les frais L1 en sont souvent la plus grande part. ethers ne renvoie pas `l1Fee`, donc je lis le reçu brut, `eth_getTransactionReceipt` via `provider.send`, et je parse les champs hexadécimaux. Vérifié au wei près : 3 sur 3 contre l'explorateur sur Ethereum, 4 sur 4 sur Base contre la baisse de solde d'expéditeurs n'ayant qu'une seule transaction dans leur bloc.

## Ce que je retiens

- V3 et V4 séparent les frais du principal, V2 les fond, et aucun ne sépare le capital investi. C'est le travail du registre des dépôts.
- V4 ne journalise aucun montant : les calculer à partir de l'état du pool au bloc précédent, les vérifier contre les transferts ERC-20, refuser plutôt qu'inventer.
- Ne compter que les positions que vos propres dépôts nomment, et vérifier `ownerOf`.
- Un prix vient d'un contrat, jamais d'un symbole. Une adresse se vérifie par son code et par les contrats qui la nomment.
- Sur un L2, lire le reçu brut pour les frais L1.
