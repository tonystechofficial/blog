---
title: "La couche invisible décide quand un seul hôte fait tourner plusieurs applis"
description: "Sur un hôte partagé, la chaîne du pare-feu, la règle du proxy, le réglage trust proxy et le PID 1 échouent sans erreur ; seule une mesure les prouve."
pubDate: 2026-08-03
track: "infrastructure"
tags: ["docker", "traefik", "iptables", "systemd"]
sources: ["infra/fermer-un-port-publie-par-docker.md", "infra/routage-par-proxy-inverse-declaratif.md", "infra/derriere-un-proxy-le-limiteur-compte-tout-le-monde-ensemble.md", "infra/serveur-qui-repond-au-ping-mais-rien-derriere.md", "infra/conteneur-dont-le-pid-1-est-bun-run-sort-en-139.md", "infra/environnements-de-dev-jetables-par-conteneur.md"]
---

Je fais tourner plusieurs applications sur des hôtes partagés, sur des sous-domaines séparés derrière Traefik. Un décompte sur l'un d'eux : 19 conteneurs, 6 pour une plateforme d'environnements de développement jetables, 2 nœuds de service pour un projet, et 9 fichiers de routage côté proxy, la plupart un par application. Une installation ordinaire, et elle m'a menti trois fois.

Un port que j'avais fermé, avec la règle visible dans `iptables -L`, répondait encore depuis Internet. Un utilisateur voyait « insufficient balance » alors que le navigateur signalait une erreur CORS, et la cause était une règle de mot de passe dans le proxy. Une limite de débit, documentée et en place, comptait chaque visiteur comme une seule personne. Chaque fois, la couche que je croyais transparente était celle qui décidait, et elle décidait sans erreur.

## La chaîne dépend de qui écoute

Une règle `INPUT` ne voit pas un port publié par Docker, et une règle `DOCKER-USER` ne voit pas un processus de l'hôte. Le trafic vers un conteneur est transféré, pas livré localement, donc il ne traverse jamais `INPUT`. La mauvaise chaîne est acceptée, listée, et n'a aucun effet.

L'ordre compte autant que la chaîne. Les accept sont insérés en tête avec `-I`, le drop est ajouté en fin avec `-A` :

```bash
iptables -I INPUT -p tcp --dport 3009 -s <proxy-network-cidr> -j ACCEPT
iptables -I INPUT -p tcp --dport 3009 -s <loopback> -j ACCEPT
iptables -A INPUT -p tcp --dport 3009 -j DROP
```

Un `-A` uniforme placerait les accept après le drop, jamais atteints, et le service devient inaccessible même pour son propre proxy.

Les règles ne survivent pas à un redémarrage, ce qui rouvre le port sans rien signaler, donc le verrouillage est un script idempotent rejoué par une unité systemd `oneshot` avec `RemainAfterExit=yes`, après `docker.service`. Tester depuis l'hôte ne prouve rien pour un port Docker, car une connexion de l'hôte vers sa propre adresse publique contourne `DOCKER-USER`. La preuve, ce sont les compteurs de paquets de la règle DROP qui augmentent dans `iptables -L DOCKER-USER -v -n`, et un test depuis une autre machine.

## Un préfixe capture plus que prévu

J'ai ajouté une règle de proxy pour mettre la page de documentation d'une API derrière un mot de passe :

```yaml
rule: "Host(`…`) && PathPrefix(`/api`)"
```

Trois contrôleurs de l'application vivaient sous ce préfixe : `api/onchain`, `api/pools`, `api/balances`. Le préfixe les a tous capturés. Le proxy répondait 401 en texte brut avant d'atteindre l'application, donc sans aucun en-tête `Access-Control-Allow-Origin`. Le navigateur signalait une erreur CORS, et l'écran la transformait en « insufficient balance ». Le symptôme était à trois niveaux de la cause.

La correction énumère des chemins exacts :

```yaml
rule: >
  Host(`…`) && (
    Path(`/api`) || Path(`/api/`) ||
    PathPrefix(`/api-`) || PathPrefix(`/api/swagger`) || PathPrefix(`/api/favicon`)
  )
```

Cette forme échoue du bon côté : un chemin oublié donne une page de documentation non protégée, visible et corrigeable, plutôt qu'une API cassée. L'indice qui a tranché : un 400 au lieu d'un 401 prouve que la requête a traversé la couche d'authentification, donc `curl -s -o /dev/null -w '%{http_code}\n'` doit donner 401 sur `/api` et pas sur `/api/onchain/…`.

## Derrière un proxy, le limiteur compte tout le monde ensemble

Un backend Express ou NestJS qui limite ses routes publiques par `request.ip` voit l'adresse du proxy tant qu'on ne lui dit pas de faire confiance au proxy, et « 20 par heure par IP » devient 20 par heure pour tout le monde. Mesuré le 5 octobre 2026 contre une vraie application Express : sans confiance, deux appelants annonçant des adresses différentes dans `X-Forwarded-For` partagent un seul compteur ; avec le réseau du proxy déclaré, chacun est lui-même, et un appelant extérieur à ce réseau ne peut pas s'attribuer une adresse.

La règle : nommer le réseau, ne jamais compter les sauts. `trust proxy: 1` et `true` disent « il y a un proxy » sans dire lequel, donc Express croit l'en-tête de quiconque atteint le port. Le défaut ne fait confiance à personne, et l'application avertit une fois quand elle voit `X-Forwarded-For` venant d'un pair en qui elle n'a pas confiance, en nommant ce pair. Cet avertissement est ce qui m'a fait trouver le bon réseau : sur Dokploy, Traefik atteint le conteneur par le réseau overlay `dokploy-network`, pas par le bridge du compose auquel le conteneur est aussi rattaché. Ensuite j'ai prouvé l'effet en staging : un appel normal, un avec un `X-Forwarded-For` falsifié, et la clé du limiteur a compté les deux sous la vraie adresse de l'appelant.

## Un port qui accepte ne prouve rien

Un VPS a cessé de me laisser entrer en SSH : une attente sans fin, ni erreur ni refus. Trois sondes interrogent trois couches. `ping` prouve que la pile réseau du noyau est vivante. Une connexion TCP prouve que le noyau accepte et que la socket est toujours liée. Seul le premier octet applicatif, une bannière SSH ou une réponse HTTP, prouve que le processus est vivant. Le piège est au milieu : le `SYN/ACK` est émis par le noyau depuis le backlog d'écoute, avant que l'application n'appelle `accept()`. Un scan qui rapporte `22 OPEN` prouve une socket liée, pas un `sshd` qui fonctionne. Le client le dit :

```
ssh -vv <user>@<host>
debug1: Connection established.
debug1: Local version string SSH-2.0-OpenSSH_10.5
Connection timed out during banner exchange
```

Le test qui tranche est de sonder un autre port que 22. Si 22, 80 et 443 acceptent tous la connexion et renvoient tous zéro octet, le noyau est debout et l'espace utilisateur ne l'est pas : disque plein, mémoire épuisée ou charge folle, par ordre de fréquence. Rien de cela ne se confirme de l'extérieur ; il faut la console hors bande de l'hébergeur.

## Le PID 1 est un lanceur

Une image construite sur `node:20` où bun ne fait qu'installer et lancer : `CMD ["bun", "run", "start:prod"]`, et `start:prod` est `node dist/main.js`. Dans le conteneur, le PID 1 est bun, et l'application Nœud est son enfant. `docker compose stop` a renvoyé le code 139, et le tiers qui déployait l'image a demandé si c'était sans danger pendant une opération d'argent.

Je l'ai reproduit le 5 octobre 2026 sans Docker, en donnant au processus le rôle de PID 1 d'un nouveau namespace :

```bash
unshare --pid --fork --mount-proc <command> &   # the command becomes PID 1 of its namespace
kill -TERM <host pid of the command>             # what `docker stop` does
wait $!                                          # unshare returns its child's code
```

`bun run start:prod` (bun 1.3.14) en PID 1 : erreur de segmentation, code 139, pendant que l'enfant Nœud ne faisait rien. `node script.js` sans gestionnaire de SIGTERM : le signal est ignoré, SIGKILL après le délai de grâce, code 137. `node script.js` avec `process.on('SIGTERM', …)` : sortie propre, code 0.

Un PID 1 n'a pas d'action par défaut : un signal sans gestionnaire est ignoré, seuls SIGKILL et SIGSTOP passent toujours, et `docker stop` envoie SIGTERM, attend 10 s par défaut, puis SIGKILL. `bun run`, `npm run`, `sh -c` s'interposent entre Docker et l'application, et rien ne garantit qu'ils transmettent le signal ; quand le PID 1 meurt, le noyau tue tout le namespace et l'enfant disparaît sans exécuter une ligne.

Un arrêt propre demande les deux : l'application en PID 1, `CMD ["node", "dist/main.js"]`, ou un vrai init avec `init: true` dans le compose, et un gestionnaire d'arrêt avec un `stop_grace_period` assez long pour finir une requête. Ne corriger que le `CMD` transforme « 139 aussitôt » en « 137 après dix secondes ».

## L'isolation n'est pas une frontière de sécurité

Les environnements jetables apportent la reproductibilité et le droit de tout casser. Mais un environnement sur le même hôte que la production partage son noyau, son disque et sa bande passante ; les conteneurs séparent des processus et des systèmes de fichiers, pas un noyau. « C'est isolé, donc c'est sûr » est faux ; la version honnête est « c'est cloisonné, donc les accidents ordinaires ne se propagent pas », et si l'enjeu le justifie, la seule réponse solide est un hôte séparé. Chaque environnement ajoute aussi une interface d'administration et des ports de service à fermer explicitement, et le disque s'use en silence jusqu'à ce que la saturation touche tout l'hôte, production comprise. Je surveille le disque de l'hôte, pas celui du conteneur.

## Ce que je retiens

- La mauvaise chaîne iptables est acceptée, listée, et ne fait rien ; la preuve est un compteur DROP qui augmente.
- Un préfixe de chemin dans le proxy répond avant l'appli et sans ses en-têtes ; une erreur CORS peut être un 401 du proxy.
- `trust proxy` nomme un réseau, lu dans l'avertissement de l'application elle-même ; sur Dokploy c'est l'overlay, pas le bridge du compose.
- Un port qui accepte une connexion prouve une socket liée ; seul le premier octet applicatif prouve un processus.
- Un lanceur en PID 1 sort en 139 sur SIGTERM ; un arrêt propre demande nœud ou un init en PID 1 plus un gestionnaire, et un conteneur n'est pas une frontière de sécurité sur un hôte partagé.
