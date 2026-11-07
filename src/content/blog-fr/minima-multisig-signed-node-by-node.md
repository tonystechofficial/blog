---
title: "Un multisig 3 sur 5 sur Minima, signé nœud par nœud"
description: "Le quorum vit dans le script du coin : le backend construit sans clé, chaque détenteur signe sur son nœud, et txncheck compte."
pubDate: 2026-09-30
track: "minima"
tags: ["minima", "multisig", "custody", "wots"]
sources: ["defi/quorum-minima-multisig-signe-noeud-par-noeud.md", "defi/verifier-une-transaction-de-pool-sur-son-propre-noeud-avant-de-signer.md", "defi/deverrouiller-pour-signer-porte-unique.md", "defi/preuve-detention-nft-noeud-minima-session.md", "defi/adresse-minima-la-casse-de-la-cle-change-l-adresse.md", "defi/restaurer-un-noeud-minima-marge-de-cles.md", "defi/declencher-l-entretien-sur-le-compteur-pas-le-calendrier.md"]
---

Sur la plateforme DeFi d'un client, une dApp vend un token Minima contre de l'USDT. Les tokens sortent d'un pool dont le script est `RETURN MULTISIG(3 k1 k2 k3 k4 k5)` : seules 3 des 5 clés publiques des experts peuvent le dépenser. Jusqu'au 30 septembre 2026, le circuit exigeait aussi trois attestations `personal_sign` de wallets EVM, qui ne prouvaient rien sur la chaîne qui détient les fonds. Depuis ce jour, le quorum est celui de la chaîne, vérifié par le backend lui-même.

Comment une transaction part après 3 signatures sur 5 :

1. Construire sans clé, sur le nœud du pool : `txncreate id:X`, `txninput coinid:…`, `txnoutput` vers l'acheteur et le change épinglé à l'adresse du pool, `txnbasics`, `txncheck`, et `txnexport id:X` donne un hex.
2. Signer nœud par nœud, chaque expert sur son propre nœud : `txnimport id:X data:<hex>`, `txnsign id:X publickey:<leur clé du pool>`, `txnexport id:X`, hex renvoyé au backend. L'accumulation est séquentielle : chaque hex contient les signatures précédentes, seul le dernier est complet.
3. Compter sur le nœud du pool : chaque hex soumis est importé sous un id jetable, puis `txncheck` renvoie `valid.signatures[{publickey, valid}]`, `allsignaturesvalid`, `signatures` et `valid.scripts`, vrai seulement quand M signatures valides issues des clés du script sont présentes. Le backend compare les clés au script du pool et refuse une clé étrangère, un hex périmé, ou deux clés à la fois.
4. Poster. La signature qui ferme le quorum poste dans le même appel, `txnpost id:X` sans `auto:` (avec `auto:true`, le TxPoW est refusé : « Burn with non unique CoinIDs »). Mesuré le 30 septembre 2026 : 63 ms entre la troisième signature et le post, miné au bloc 2 341 727, change revenu dans le pool.

Répété sur un réseau privé de sept nœuds jetables, une chose m'a surpris : `txnpost` répond `status: true` à une et à deux signatures, et la transaction n'est jamais minée. Le contrôle avant l'envoi est `txncheck` et `valid.scripts` ; la preuve après est le coin qui a bougé.

## Le quorum est dans le script, pas dans la base

Sur Minima, le « contrat » est l'adresse elle-même, le hash du script. Seul le nœud qui construit a besoin de le connaître (`newscript trackall:true`) pour joindre script et preuves dans `txnbasics` ; les nœuds signataires n'ont besoin que de leur clé. Chaque détenteur peut calculer l'adresse du pool sur son propre nœud avec `runscript script:"RETURN MULTISIG(3 k1 … k5)"`, qui renvoie `clean.mxaddress` sans rien enregistrer, et comparer avant qu'un seul token ne bouge.

Deux conséquences pour qui dépose des fonds. Le script est figé dans l'adresse : changer une clé ou le seuil implique une nouvelle adresse, et y déplacer les fonds avec 3 des 5 anciennes clés. Et il n'y a pas de clé de récupération : trois clés perdues et le pool est bloqué pour toujours.

Changer le seuil, c'est donc migrer le pool. Écrire un nouveau M dans la configuration ne change rien : la chaîne continue d'exiger l'ancien, et le backend refuse tout achat dont le M-sur-N diffère du script. La migration, spécifiée le 12 octobre 2026 : calculer la nouvelle adresse avec `runscript`, l'enregistrer avec `newscript trackall:true` là où le pool doit être vu, suspendre les livraisons tant que quelque chose est en cours de signature, déplacer tous les tokens vers la nouvelle adresse en une transaction signée sous le quorum en vigueur, et une fois qu'elle est finale à 50 blocs, basculer l'adresse et le M-sur-N en une seule activation de configuration. Un paramètre que la chaîne impose se change en déplaçant les fonds sous la nouvelle règle ; la base suit.

## Vérifier sur son propre nœud avant de signer

Une revue du 14 octobre 2026 a trouvé que le contrôle pré-signature de la dApp expert était satisfait par construction : les « sorties attendues » venaient du même paquet que la transaction, et le script était affiché sans être relié à l'adresse payée. Un backend compromis pouvait afficher `MULTISIG(3 <les clés de la DAO>)`, payer sa propre adresse, et récolter trois signatures sur tout le pool.

Le correctif attache tout au nœud du signataire : il calcule l'adresse du script affiché (`runscript`, `clean.mxaddress`), qui doit être égale à l'adresse de sortie telle que le nœud a décodé la transaction, et non telle que le serveur la décrit ; le token et le montant se lisent dans ce décodage (`txnlist` après `txnimport`) ; M et les clés sont comparés à la proposition que deux experts ont confirmée, et l'expert doit reconnaître les clés convenues. Quand une preuve manque, la signature reste désactivée. La limite : un backend qui contrôle aussi la configuration de gouvernance peut tout faire concorder sur des clés de son choix, et seuls les yeux de l'expert l'arrêtent.

## Une seule porte pour déverrouiller, signer, reverrouiller

Un nœud qui signe a besoin de ses clés privées en clair sur disque ; un nœud qui détient des fonds ne devrait pas les y laisser. Le nœud reste donc verrouillé et s'ouvre le temps d'une signature. Cela ressemble à « une modale qui demande le mot de passe », et la modale est la partie facile. L'unité que je code est une porte unique, une fonction qui prend la commande à exécuter :

```js
const signature = await withVaultOpen({
  reason: 'send',
  run: (cmd) => cmd(`sign data:… publickey:…`),
});
```

L'appelant ne voit jamais le mot de passe, l'état du verrou ni la fenêtre. Six propriétés, chacune avec un test que j'ai vu échouer d'abord : un seul point de passage, gardé par un test qui échoue sur toute commande de signature hors du dossier de la porte ; tous les appels réseau avant la fenêtre, qui ne contient que le déverrouillage, la commande, le reverrouillage ; refus, et non mise en file, pour un appel concurrent ; un flag persistant posé avant le déverrouillage et retiré après le reverrouillage, puisque `finally` ne survit pas à un onglet fermé ; le mot de passe dans une ref, jamais dans le state ; et un contrôle du jeu de caractères, puisqu'une espace dans une chaîne de commande la tronque silencieusement.

Le 14 octobre 2026, un testeur est tombé sur l'autre mode de défaillance : la connexion passait par la porte, mais la preuve des 64 clés du wallet, écrite à part, signait directement et répondait « vos clés sont verrouillées ». Toute fonction qui signe passe par la même porte ; pour une série, ouvrir une fois, tout signer, fermer dans un `finally`.

Une session n'aide que si elle dispense de re-signer, pas de prouver : sur les six étapes de la connexion, seule la signature du nonce a besoin de la clé, donc le renouvellement rejoue `coins` et `coinexport` et le backend vérifie avec `coincheck`, lié à la clé publique du token ; un NFT transféré échoue aussitôt. La durée effective est le minimum de trois bornes : le TTL signé, le stockage côté client (un token de 30 jours dans `sessionStorage` meurt avec l'onglet), et la cadence réelle des re-preuves, qui était nulle : l'endpoint de renouvellement n'avait aucun appelant côté client.

## Clés, casse et compteurs

Le 15 octobre 2026, un détenteur avec 657 tokens de test répartis en cinq coins lisait « pas encore compté », et le backend journalisait `coins=0 counted=0 addresses=64` avec 64 clés prouvées. Minima calcule l'adresse d'un script à partir de son texte, et le nœud écrit `RETURN SIGNEDBY(0xABCD…)` avec la clé en hexadécimal majuscule. Le backend stockait les clés en minuscules et dérivait `RETURN SIGNEDBY(0xabcd…)` : une autre adresse, vide, 64 fois. Deux commandes `newscript` ont tranché en dix minutes. Normaliser pour comparer n'est pas normaliser pour calculer. Toujours dériver à partir de la clé en majuscules.

Les signatures Minima sont à état (WOTS) : une clé qui signe deux fois au même index divulgue son matériel privé, et une sauvegarde fige un compteur que le nœud continue d'avancer. `restore` ajoute une marge codée en dur de 256 au `uses` stocké (`UPDATE keys SET uses=uses+?`, une marge, pas une position absolue). `restoresync` l'expose sous `keyuses:`, mais avec `host:` et une sauvegarde de plus de 2 jours, il resynchronise d'abord et revient sans la marge quand le nœud d'archive est injoignable. Donc : `restoresync` sans `host:`.

Une sauvegarde est sûre tant qu'elle a moins de 256 signatures de retard sur la clé la plus utilisée, donc je rappelle à 200 d'écart, en prenant le maximum sur les clés (un `sign` fait passer exactement une clé de `uses:0` à `uses:1`). À la 257e signature, rien ne se passe sur le nœud ; le dégât n'apparaît que le jour de la restauration.

## Ce que je retiens

- Le backend construit sans clé, chaque détenteur signe sur son nœud, et `txncheck` compte : `valid.scripts` n'est vrai qu'à M.
- `txnpost` qui renvoie `status: true` ne prouve rien. Le coin qui a bougé, si.
- Un seuil vit dans le script. Le changer est une migration du pool, jamais une modification de base.
- Avant de signer, laisser son propre nœud relier le script à l'adresse payée et lire les sorties ; refuser quand une preuve manque.
- Des clés en majuscules pour dériver les adresses. Compter les signatures, pas les mois, pour décider quand sauvegarder.
