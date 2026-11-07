---
title: "Ce que vous ne pouvez pas lire doit devenir un écart, jamais un zéro"
description: "Sur un chemin qui calcule de l'argent, une lecture échouée écrite 0 est un faux chiffre sans signal : toute source illisible doit remonter comme un écart."
pubDate: 2026-10-16
track: "onchain"
tags: ["defi", "reliability", "nav", "testing"]
sources: ["defi/comptabilite-lp-d-un-fonds-un-zero-silencieux-contre-un-ecart-signale.md", "securite/panne-de-fournisseur-vs-resultat-vide.md", "defi/un-fournisseur-de-soldes-qui-refuse-sa-cle-doit-etre-un-ecart-pas-un-zero.md", "defi/une-doublure-qui-leve-la-ou-le-vrai-service-avale.md", "defi/un-recu-null-n-est-pas-une-transaction-en-attente.md", "defi/une-cascade-de-repli-doit-s-arreter-sur-un-refus.md"]
---

## Quatre défauts, une même forme

Le 12 octobre 2026, le gérant du fonds DeFi d'un client m'a demandé si la comptabilité de ses positions LP était parfaite. Le fonds détient des positions sur Uniswap V2, V3 et V4, sur PancakeSwap et sur THORChain. Il les compte dans sa NAV et les affiche sur deux dashboards. Aucune position n'existait encore sur l'environnement du client, tout reposait donc sur le code. Je l'ai audité, affirmation par affirmation, dans le code.

L'essentiel était juste : frais non collectés comptés, positions hors plage valorisées, rien compté deux fois. Les quatre défauts que j'ai trouvés avaient tous la même forme, un faux chiffre sans signal. Deux exemples. La clôture quotidienne, qui fige les chiffres du jour sous une empreinte, écrivait « aucune position, 0 $ » quand les positions ne pouvaient pas être lues, et le scellait pour toujours. Un rate limit sur un `eth_call` devenait un `CALL_EXCEPTION` dans ethers 6, que le code lisait comme un NFT brûlé, et la position sortait de la NAV.

Quatre jours plus tard, la même forme est apparue à plus grande échelle. Moralis avait arrêté ses anciens plans gratuits le 1er septembre 2026 : la clé reste, l'usage est suspendu jusqu'à abonnement, à partir d'environ 149 dollars par mois, et chaque appel renvoie 401, pour toujours. Le flux de soldes du fonds lisait encore cinq chaînes via Moralis, Polygon, Avalanche, Arbitrum, Optimism et Base, avec des appels tolérants : l'erreur était avalée, la méthode renvoyait `[]`, et chaque chaîne ressemblait à un portefeuille vide. Pendant six semaines, cinq chaînes se sont lues comme zéro sans un mot. Le fonds n'y détenait rien, donc aucun dégât, par chance. Le journal portait environ 45 lignes Moralis par minute, deux avertissements répétés, et c'est le client qui l'a signalé, à 28 avertissements par minute.

## Pourquoi un zéro est la pire réponse

J'avais déjà rencontré ce motif le 11 août, sur un vrai chemin de valorisation avec une clé d'API révoquée. Le client attrapait l'erreur et renvoyait `[]`. La fonction voisine attrapait et renvoyait `{ balance: '0' }`. L'agrégateur attrapait par chaîne, posait `[]` pour chacune, et renvoyait son objet sans lever d'exception. Le repli réussissait avec un résultat vide, et la valorisation valait 0. Pire : un second fournisseur était configuré après celui-là, et il n'a jamais été essayé, parce que rien n'avait levé d'exception.

Un investisseur ouvre le dashboard et voit un fonds vide alors que l'argent est là, et le montant retirable est calculé sur cette valeur : une clé expirée devient une perte apparente, sans un seul message d'erreur.

Un zéro qui a été observé et un zéro qui veut dire « je n'ai pas pu lire » sont identiques pour tout ce qui est en aval. Sur un chemin qui calcule un total, un résultat partiel est un faux chiffre présenté comme exact. Mieux vaut n'afficher rien que d'afficher trop peu.

## Le garde-fou mort, et le test qui le disait vivant

La règle existait dans le code depuis août : un drapeau `strict` faisait lever une exception au client de soldes au lieu de renvoyer `[]`. Le 5 octobre, j'ai lu huit heures de journaux de staging : 2 279 lectures de jetons échouées et 2 200 lectures de solde natif échouées, toutes en 401, et pas une seule ligne du `catch` qui déclare une chaîne illisible. Le lecteur des cinq chaînes appelait le client sans `strict`, puis comptait sur son propre `catch`. Ce `catch` ne pouvait jamais s'exécuter, parce que la couche du dessous avalait tout.

Le test qui prouvait le garde-fou simulait la panne avec `mockRejectedValue(new Error('401'))`, une doublure qui lève une exception. Le vrai client renvoie zéro. Le test était vert et ne disait rien du vrai chemin. En août, mon premier correctif avait échoué de la même façon : compter les échecs dans le `catch` par chaîne de l'agrégateur, un `catch` qui ne se déclenche jamais. Un garde-fou mort que l'on croit vivant est pire qu'un garde-fou absent : il clôt le sujet.

## Deux autres visages du même défaut

Un reçu `null`. Une position Uniswap V4 n'est pas listée on-chain. Le lecteur la trouve par la transaction qui l'a créée et lit le reçu sur le premier nœud d'une liste qui répond. Le code d'origine traitait un reçu `null` comme « pas encore miné, relire au prochain passage ». Le 11 octobre, j'ai mesuré qu'Alchemy sans clé, sur World Chain, sert l'état jusqu'à 5 000 000 de blocs en arrière et renvoie `null` pour un reçu de plus de neuf heures environ. Un nœud Celo public a renvoyé `null` pour un reçu vieux d'environ trois semaines. Conserver l'ancien état et conserver les reçus sont deux politiques de rétention distinctes. Après un redémarrage, la position du fonds n'était plus lue : absente de la valeur, sans erreur. Un `null` est le trou de ce nœud, pas un état de la transaction.

Une cascade de repli. Le backend lit à travers une liste de RPC et passe la même lecture au suivant en cas d'échec. Une transaction sur Base a déplacé deux positions Uniswap V4 d'un coup. Chacun des six RPC l'a lue et l'a refusée avec « 2 positions moved in one transaction ». La cascade gardait la dernière erreur, et le dernier RPC, limité en débit, avait répondu « 429 Too Many Requests » avant de rien lire. Le journal disait « V4 amounts not computed, 429 ». Un opérateur aurait attendu la fin d'une panne qui n'existait pas, alors que le mouvement demandait un règlement manuel. Six lectures complètes pour un refus connu dès la première.

## La pratique

Des lectures strictes sur les chemins d'argent. Le client garde son mode tolérant pour la découverte au mieux, et le chemin d'argent demande le mode strict :

```ts
getBalances(address, chain, { strict: true })   // propagates
getBalances(address, chain)                     // returns [], historical behaviour
```

Le déclencheur est « une source a échoué », jamais « une source est vide ». Un portefeuille qui ne détient rien est une réponse, pas une panne.

Un état illisible. Une chaîne dont la lecture échoue est marquée illisible et la valorisation porte l'écart. La clôture quotidienne enregistre désormais les écarts du jour et écrit `null` pour la part mutualisée, ce qui bloque les clôtures au lieu de corrompre la NAV. Cela a un coût : la lecture LP est tout ou rien sur 19 chaînes, donc une chaîne illisible vide toutes les positions de l'affichage, et la valorisation chaîne par chaîne est le prochain chantier.

Une clé refusée est de la configuration, pas une panne. Un 500, un 429 ou un timeout sont des pannes qui méritent un nouvel essai. Un 401 ou un 403 met l'intégration en pause une heure et le dit une seule fois. Sans clé, aucun appel ne part. C'est une règle pure, le temps passé en argument, testée seule et placée comme garde unique. Dans le journal, « key refused, paused until HH:MM » une fois par heure est l'état attendu, pas un incident. Retirer la clé de l'environnement ne suffit pas tant que le code appelle encore sans en-tête.

Un reçu `null` interroge `eth_getTransaction` sur le même nœud. Connue sans bloc : en attente, relire plus tard. Inconnue : nœud suivant. Aucun nœud ne l'a : illisible, jamais zéro. Et une fois la transaction confirmée, l'enregistreur note le numéro de position pour que plus rien ne dépende du reçu.

Une cascade s'arrête sur un refus de données. Je type le refus là où il est décidé, dans une classe d'erreur dédiée, et je le relance tel quel depuis la cascade. La raison garde ses mots et la cascade s'arrête au premier RPC, en 283 ms au lieu de six lectures. Dans le doute, c'est une panne : un état incohérent entre deux blocs peut venir d'un nœud en retard. Je ne devine pas à partir des codes d'erreur ; le timeout imposé par mon propre wrapper est une erreur sans code.

Vérifier par mutation. Retirez la propagation et regardez le test échouer. S'il reste vert, la doublure implémente `strict` elle-même. Au moins un test fait tourner le vrai client contre un transport qui renvoie 401.

## Ce que je retiens

- Un zéro observé et un zéro pour une lecture échouée ne doivent jamais se ressembler. Le critère est l'échec, pas le vide.
- Un garde-fou dans un `catch` dépend de chaque couche en dessous. Une seule couche qui avale, et il est mort.
- Une doublure de test doit échouer comme échoue le vrai collaborateur. Lisez ce que fait le vrai avec une erreur avant d'écrire `mockRejectedValue`.
- Le contrôle vivant est dans les journaux : des milliers d'erreurs et aucune ligne du garde-fou signifient qu'il ne tourne pas, quoi que dise le test.
- Une clé refusée est un fait de configuration. Pause d'une heure, le dire une fois.
