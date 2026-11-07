---
title: "Une chaîne Minima privée à deux nœuds comme banc de test"
description: "Les flags du réseau privé sont une propriété du processus, pas du genesis : retirez-les une fois et le pair vous blackliste."
pubDate: 2026-09-23
track: "minima"
tags: ["minima", "docker", "test-bench", "h2"]
sources: ["defi/chaine-privee-minima-deux-noeuds-drapeaux.md", "defi/monter-un-env-preprod-dapp-minima.md", "defi/remettre-un-banc-de-test-a-zero-sans-fausses-correspondances.md", "defi/patcher-un-minidapp-a-chaud.md", "defi/h2-de-minima-n-est-pas-mysql-sqlstring-n-echappe-pas.md", "defi/minima-mds-reference.md"]
---

Le banc de test local de la plateforme DeFi d'un client fait tourner deux nœuds Minima sur une chaîne privée, à l'écart du mainnet : un nœud émetteur qui crée le genesis, et un nœud utilisateur qui s'y rattache. Dans Docker, l'émetteur démarre avec `-solo` (équivalent de `-test -nop2p`), ce qui crée le genesis. Le nœud utilisateur démarre avec `-test -nop2p -connect <issuer>:<port>` et rejoint la chaîne existante sans en créer une seconde.

Une fois le genesis créé, la tentation est de retirer `-solo` du service émetteur : le genesis est dans la base, donc le flag « ne sert plus à rien ». C'est faux, et l'erreur n'apparaît pas là où on la cherche.

Ce que j'ai mesuré le 23 septembre 2026 : `-test` fixe aussi les paramètres réseau du processus, ainsi que la version que le nœud annonce dans son greeting. Un nœud démarré avec `-test` se présente comme `1.0.47-TEST` ; le même nœud sans le flag se présente comme `1.0.47`. Les deux refusent de se parler :

```
Greeting with Incompatible Version! 1.0.47-TEST .. we are 1.0.47
```

Côté appelant, le refus est plus explicite, et c'est là que se trouve le piège :

```
Connected attempt success to <issuer>:9001
Greeting with Incompatible Version! 1.0.47 .. we are 1.0.47-TEST
INVALID PEER added to List! <issuer>:9001
```

Trois conséquences s'enchaînent. La connexion TCP réussit, `docker ps` est au vert, et le rejet est applicatif. Le nœud sans le flag n'a aucune chaîne : son RPC répond `{"status":false,"error":"NO Blocks yet.."}` et ses logs répètent `No tip found in Main Checker..`. Et le pair est blacklisté, donc les tentatives de reconnexion s'arrêtent. Corriger le flag et redémarrer le seul nœud fautif ne suffit pas : le nœud qui l'a blacklisté ne le rappellera pas.

## Pourquoi le flag est une propriété du processus

L'aide du nœud le dit en une ligne :

```
-solo   Run a solo/private network (-test -nop2p) and will run -genesis ONLY the first time
```

`-solo` porte les deux flags réseau à chaque démarrage et ne crée le genesis que lorsque le dossier de données est vide. C'est le bon flag permanent pour l'émetteur ; mon premier raisonnement confondait « crée un genesis » avec « crée un genesis à chaque fois ». Un nœud qui rejoint une chaîne qu'il n'a pas émise est un cas différent : son dossier de données est vide, et `-solo` lui construirait un genesis à lui. Ce nœud prend `-test -nop2p` et se rattache à son pair.

Retirer un flag « parce que son effet est déjà dans la base » est un pari sur ce que fait réellement le flag. Le genesis était persistant ; l'identité réseau annoncée à chaque greeting ne l'était pas, et c'est elle qui portait la compatibilité entre les deux nœuds. Si un nœud garde `-test` à chaque démarrage et que l'autre ne le garde pas, l'un des deux a tort, même si le banc fonctionne jusqu'à ce que quelqu'un redémarre.

## Se rattacher sans nouveau genesis

1. Donner au nœud fautif `-test -nop2p`, sans `-solo`.
2. Le laisser appeler son pair, puisque le pair ne rappellera pas. En RPC : `connect host:<peer>:<port>`. La réponse est immédiate et l'Initial Block Download suit :

   ```
   Connected attempt success to <user>:9011
   [+] Connected to the blockchain Initial Block Download received. size:44.4 KB blocks:34
   Saving Cascade in ARCHIVEDB.. tip : 5007
   ```

3. Vérifier l'accord sur la même hauteur et le même tip.

## La trésorerie de la chaîne vit dans un seul wallet

Rétablir le lien ne suffisait pas. Sur une chaîne privée, `-genesis` place toute l'émission dans le wallet du nœud qui l'a créée. Perdre les données de ce nœud ne détruit pas la chaîne, qui garde ses blocs et son million d'unités, mais plus personne ne détient la clé. Les deux nœuds affichent alors `coins: 0` avec un `total` intact, et le total ressemble à un solde.

La conséquence apparaît loin de là. Sans coin, le nœud refuse `tokencreate`. Le mint du token d'identité échoue, et l'utilisateur voit un écran générique « service indisponible ». La commande le dit en un mot :

```
{"command":"tokencreate","status":false,"error":"No Minima Coins available!"}
```

Quand une fonctionnalité qui crée quelque chose échoue, je vérifie désormais `coins` avant tout le reste, et je ne fais pas confiance à `total`. Une trésorerie perdue sur une chaîne privée n'est pas récupérable : pas de faucet, seulement un nouveau genesis.

## Ordre des opérations pour une preprod

Une preprod complète ajoute aux deux nœuds une MongoDB vierge, le backend et deux MiniDapps, chaque nœud étant une JVM d'environ 1,2 Go. L'ordre compte plus que les commandes : Mongo, puis les nœuds synchronisés (les deux renvoient le même `chain.block` sur `/status`), puis le backend, puis les dApps buildées en dernier, parce que l'URL du backend est figée à la compilation. Les scripts de build peuvent injecter l'URL de production en surchargeant `.env`, donc je la passe en ligne de commande (`VITE_API_BASE_URL=… bun run build`).

## Remettre le banc à zéro sans fausses correspondances

Le 3 octobre 2026, après qu'un fork avait laissé des ordres bloqués, j'ai dû réinitialiser la base du banc. La tentation est de la vider. Une base de test contient deux choses : l'historique des tentatives, jetable, et les observations de la chaîne, qui décrivent un état qui existe toujours après la réinitialisation. Une vente est rapprochée de n'importe quelle détection de coin de pool non consommée, par montant exact, la plus ancienne d'abord. Vider la table des détections ne supprime pas les coins : le monitor les re-détecte au tick suivant, non consommés. Le banc avait des coins de pool de 50, 100, 50 et 100. La vente suivante de 50 ou 100 aurait été payée sans que rien soit envoyé.

La règle : supprimer l'historique, garder chaque observation dont l'objet existe encore sur la chaîne. Sauvegarder d'abord, dans le conteneur puisque `mongodump` n'est pas sur l'hôte :

```bash
docker exec -e URI="$URI" <mongo> sh -c 'mongodump --uri="$URI" --archive --gzip' > backup.archive.gz
```

Ensuite : liste des coins lue sur la chaîne, un dry run qui affiche ce qui serait supprimé, backend arrêté, suppression, redémarrage, relecture par l'API. Le script refuse un coin au pool sans ligne de détection.

## Patcher un MiniDapp à chaud

Un MiniDapp vit dans `<data>/1.0/mds/web/<uid>/`, avec sa base H2 dans `<data>/1.0/mds/data/<uid>/sql/sqldb.mv.db`. Écrire dans le dossier web ne suffit pas : MDS garde le script chargé en mémoire. Il faut reconditionner le contenu du dossier (pas le dossier parent) en zip, puis le recharger avec le même uid, ce qui préserve la base :

```bash
cd /tmp/build && zip -qr /tmp/patch.mdz .
curl -sk -u minima:<RPC_PASSWORD> \
  "https://127.0.0.1:<MDS_PORT>/mds%20action:update%20uid:<uid>%20file:<basefolder>/patch.mdz"
```

La commande passe dans le chemin de l'URL, espaces encodés. `uninstall` puis `install` crée un nouvel uid et abandonne le dossier de données. Le rechargement a environ 3 minutes de latence, donc j'attends au moins 5 avant de conclure, et la seule preuve que le nouveau code tourne est une ligne de log qu'il émet, lue avec `journalctl -u minima -f | grep --line-buffered PATCH`. Un effet de plus, mesuré deux fois : une mise à jour tue les sessions des pages déjà ouvertes. Le nœud journalise `MDS Invalid SessionID Exception`, et l'onglet garde l'ancien code. Ne mettez pas à jour un MiniDapp pendant que quelqu'un le teste.

## H2 n'est pas MySQL

Un MiniDapp stocke ses données locales via `MDS.sql(...)` dans sa propre base H2. La dApp utilisateur échappait ses valeurs avec `sqlstring.escape()`, un package écrit pour MySQL. En SQL standard, donc en H2, l'apostrophe s'échappe en la doublant (`''`) et l'antislash est un caractère ordinaire. Ainsi `x'; DROP TABLE data; --` devient `'x\'; DROP TABLE data; --'`, que H2 lit comme la chaîne `x\` suivie d'une seconde instruction, exécutée. Et `{"a":1}` devient `'{\"a\":1}'`, stocké tel quel, que `JSON.parse` refuse. Mesuré le 19 octobre 2026 : le registre local des envois de vente est devenu illisible dès sa première écriture et ne s'est jamais rétabli.

Le correctif est `'` + `value.replace(/'/g, "''")` + `'`, avec les nombres, booléens et `null` en littéraux et tout le reste refusé. Les tests qui découpaient les littéraux à la MySQL (`'(?:\\.|[^'\\])*'`) validaient exactement le défaut ; un test doit lire les littéraux comme le moteur cible, `'(?:''|[^'])*'` pour H2.

## Ce que je retiens

- Les flags du réseau privé se passent à chaque démarrage : `-solo` pour l'émetteur, `-test -nop2p -connect` pour les autres.
- Un pair blacklisté ne rappelle pas. Corriger le flag, puis faire appeler le nœud fautif.
- La trésorerie est dans le wallet de l'émetteur. Quand le mint échoue, lire `coins`, pas `total`.
- Réinitialiser l'historique, garder les observations de la chaîne, sinon la prochaine correspondance paie dans le vide.
- `mds action:update` avec le même uid garde la base. Nommer le moteur SQL avant de choisir un échappement.
