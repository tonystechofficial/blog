---
title: "Une transaction Minima que votre nœud dit minée peut ne pas être dans la chaîne"
description: "Cinq inclusions provisoires en 67 minutes : sur Minima, l'inclusion se prouve par le bloc canonique qui dépense l'input, pas par la première observation."
pubDate: 2026-09-30
track: "minima"
tags: ["minima", "confirmation", "reorg", "txpow"]
sources: ["defi/une-transaction-minima-minee-par-votre-noeud-peut-ne-pas-l-etre.md", "defi/savoir-si-un-noeud-minima-est-sur-la-bonne-chaine.md", "defi/mds-et-rpc-minima-deux-reponses-trompeuses.md", "defi/un-envoi-dont-on-ignore-l-issue-n-est-pas-un-refus.md"]
---

Sur la plateforme DeFi d'un client, un backend poste des envois de tokens vers Minima avec `txnpost`, puis les confirme en surveillant la chaîne : le coin d'entrée a quitté l'ensemble des non-dépensés, le coin de change est apparu à l'adresse épinglée, et sa profondeur (tip moins `created`) a atteint 50 blocs. Le 30 septembre 2026, un achat posté à 11:10 UTC n'a jamais atteint 50. Sa profondeur retombait sans cesse à zéro.

Le log de confirmation raconte l'histoire. Le coin de change était « créé » au bloc 2 341 727, profondeur de 1 à 20. Puis « coin d'entrée non dépensé, change absent ». Puis créé en 2 341 758, retiré, 2 341 761, 2 341 766, 2 341 770, et enfin 2 341 776. Même coin id à chaque fois (un coin id dérive de la transaction), avec un `created` qui changeait. La même transaction, incluse puis écartée, cinq fois.

Aucun des cinq premiers blocs ne la portait sur la chaîne publique. Un seat du banc et un nœud indépendant sur le même serveur avaient le même hash de bloc à chacune de ces hauteurs, et seul le bloc 2 341 776 contient une transaction qui dépense le coin d'entrée. Retard réel : environ 67 minutes.

Le cas sain, mesuré le 4 octobre 2026 avec les nœuds du banc à la hauteur de l'explorateur public : un achat posté à 13:25:08 UTC a été vu dans la chaîne 82 secondes plus tard (bloc 2 348 778, profondeur 1), n'a jamais bougé, et est passé CONFIRMED à 50/50 à 14:09:30 UTC. Soit 44 minutes 22 secondes, 50 blocs à environ 50,5 secondes chacun.

## Pourquoi le « miné » d'un nœud est provisoire

Minima est une chaîne UTXO où chaque nœud est un full nœud et où chaque transaction porte sa propre preuve de travail, un TxPoW. Ce qu'un nœud rapporte après un post est sa vue courante du tip, et cette vue est provisoire : un bloc que le nœud a accepté peut être supplanté, et le coin qu'il vous montrait disparaît avec lui.

Même hauteur ne veut pas dire même chaîne, et le fait que vos nœuds s'accordent entre eux ne prouve rien. Le 29 septembre 2026, sur le serveur de test, l'explorateur public indiquait le bloc 2 340 160. Le nœud utilisateur était à 2 340 160 avec 49 pairs. Les seats 1, 3 et 4 étaient à 2 335 971 avec 11, 1 et 1 pairs. Le seat 2 était à 2 324 900 avec 0 pair. Les seats 1, 3 et 4 s'accordaient bloc pour bloc, et tous trois étaient sur un fork. La cause probable, que je n'ai pas vérifiée, était une coupure réseau de l'hôte du 22 au 28 septembre 2026.

Ce que coûte un fork : un achat du 30 septembre a été signé, diffusé, et marqué CONFIRMED à 50 blocs par le nœud qui le construisait alors qu'il était sur un fork. Revenu sur le mainnet, rien n'existait. Le coin du pool était toujours non dépensé, l'acheteur n'avait rien reçu, et la base disait toujours CONFIRMED. La profondeur se mesure sur la chaîne propre du nœud.

## Prouver l'inclusion

Ce qui tranche, c'est l'identité du bloc à une hauteur donnée, pas la hauteur.

```
txpow block:<height>      →  response.txpowid
```

Deux nœuds sur la même chaîne renvoient le même `txpowid` pour la même hauteur. Un id différent, c'est une autre chaîne, quelles que soient les hauteurs. L'achat marqué CONFIRMED le 30 septembre avait enregistré un id de bloc à la hauteur 2 342 241 ; le 3 octobre, un nœud revenu sur le mainnet en portait un autre.

Pour trouver le bloc canonique qui porte une transaction :

1. Même chaîne ? Lancer `txpow block:<h>` sur deux nœuds qui ne dépendent pas l'un de l'autre. `response.txpowid` doit correspondre.
2. Quel bloc dépense l'input ? Pour chaque hauteur candidate, lire la transaction propre du bloc (`response.body.txn`) et chacune de celles listées (`response.body.txnlist`, puis `txpow txpowid:<id>`, puis `body.txn.inputs[].coinid`). `txns=0` dans `txnlist` ne veut pas dire que le bloc ne porte rien : il porte aussi son propre `body.txn`.
3. Même méthode pour un dépôt. Avant de payer une vente, une transaction canonique doit avoir payé le montant à l'adresse du pool.

Deux pièges. L'id renvoyé par `txnpost` n'est pas l'id du TxPoW miné : `txpow txpowid:<posted id>` répond `status: false`. Le 4 octobre 2026, cette commande a répondu `TxPoW not found` sur les quatre seats alors que la transaction était dans la chaîne depuis 43 minutes (`txpow onchain:<posted id>` donnait aussi `found: false`). C'est l'id d'avant le minage ; ce qu'un nœud peut retrouver, c'est le bloc. Et sur un nœud qui ne suit pas l'adresse, `coins coinid:<id> relevant:false` ne trouve rien. Ce n'est pas une preuve d'absence.

## Savoir si le nœud est sur la bonne chaîne

Comparer à l'explorateur public, jamais aux voisins :

```bash
curl -s https://explorer.minima.global/api/stats
# {"topBlock":2340160,"averageBlockTime":"50.26","blocksInLastTwentyFourHours":1719,...}
```

Seul `/api/stats` répond, donc la référence externe est une hauteur ; l'identité des blocs se compare entre mes propres nœuds, ou avec ce qu'une confirmation a enregistré.

Sur le nœud, `block` renvoie la hauteur en millisecondes, là où `status` peut prendre plus de 10 secondes. `status` donne aussi `network.connected` : 0 signifie que le nœud mine seul, sur son propre fork dès le premier bloc. Avoir des pairs ne suffit pas. Le seat 1 en avait 11 et est resté 4 189 blocs en retard : au-delà d'une certaine profondeur, un nœud ne se réorganise plus tout seul.

Le remède est une resynchronisation de la chaîne, qui ne demande aucune phrase et garde le wallet :

```
archive action:resync host:<ip:port of an archive node>
```

Mesuré sur le seat 1 : moins de deux minutes, wallet intact, coins des scripts suivis retrouvés avec les mêmes coin ids. Seule perte : les coins créés avant le bloc de départ de la resynchronisation (2 290 495), ici trois NFT, qui n'étaient plus listés. Ils existent toujours sur la chaîne. `megammrsync` n'était pas une option : il ne cherche que les 64 clés du wallet, pas les scripts suivis comme l'adresse du pool.

Le garde-fou que j'ai ensuite mis dans le backend, le 3 octobre 2026, compare la hauteur du nœud au `topBlock` de l'explorateur avant de diffuser et avant de confirmer. À moins de 20 blocs, c'est « sur le mainnet » ; au-delà, en retard ou en avance, c'est « hors mainnet » ; illisible, c'est « inconnu ». Les deux derniers refusent, jamais « présumé bon ». Comme la référence devient un point de défaillance unique, je garde la dernière hauteur obtenue et je l'étends au rythme des blocs (`averageBlockTime`, environ 50 s) pendant 30 minutes au maximum. Un second garde-fou fait échouer, donc rend rejouable, une ligne diffusée depuis plus de 6 heures dont l'input n'existe plus et dont le change n'est jamais apparu, vu depuis un nœud sur le mainnet. À son premier passage, il a clos un achat bloqué depuis 71 heures. Au moindre doute, rien n'est échoué : un humain regarde. Le même contrôle a sa place partout où le code croit un nœud, du listing des coins à la confirmation : le 30 septembre, trois experts ont signé une transaction construite sur un coin issu d'un fork que le mainnet ne pouvait pas miner.

## Une issue inconnue n'est jamais un refus

Dans un MiniDapp, `MDS.cmd` rappelle avec `{}` en cas d'échec réseau, sans aucun `status`. Un wrapper qui lit « pas de status » comme un échec transforme un envoi que le nœud a peut-être exécuté en refus. Une dApp de vente a reproposé l'envoi et des tokens sont partis deux fois (revue du 14 octobre 2026). Il y a trois issues : en attente (un nœud en lecture seule met la commande de côté), refusé (`status: false` avec une erreur), inconnu (`{}`, une exception, un timeout). Seul « refusé » autorise à oublier un envoi. « Inconnu » se vérifie sur le nœud avant tout nouvel essai : dans `history`, une transaction qui paie cette adresse et ce montant ; dans `coins`, les coins relevés juste avant l'envoi.

Côté serveur, même règle. Après `txnpost`, l'absence de réponse ou une réponse sans txpowid laisse la ligne en `BROADCAST` sans hash, non rejouable, et le balayage la confirme depuis la chaîne si elle est partie. Seul un refus explicite du nœud est `FAILED`, et une erreur à l'écriture du hash après un post réussi ne doit jamais marquer `FAILED`, parce que `FAILED` est rejouable : toute erreur postérieure à l'envoi qui y est classée est un double paiement différé. Il en va de même pour un wallet EVM qui signe et diffuse lui-même : seul un échec avant la requête, ou un refus explicite de l'utilisateur (code EIP-1193 4001), prouve que rien n'est parti.

## Ce que je retiens

- Compter la profondeur depuis la dernière observation, et repartir de zéro quand le coin disparaît.
- La preuve d'inclusion est un bloc canonique, même `txpowid` sur deux nœuds indépendants, avec une transaction qui dépense le coin d'entrée.
- L'id renvoyé par `txnpost` n'est pas l'id du TxPoW miné. `TxPoW not found` ne veut pas dire « rien n'est parti ».
- Comparer chaque nœud à la hauteur de l'explorateur public, pas à ses voisins. `network.connected = 0` est un nœud qui mine seul.
- Un envoi dont l'issue est inconnue se vérifie sur le nœud, il n'est jamais rejoué. Ne jamais payer deux fois.
