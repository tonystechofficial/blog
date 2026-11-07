---
title: "Migrer une app en production vers un PaaS auto-hébergé sans perdre un octet"
description: "Une répétition sur une copie de la production, des sauvegardes prouvées par empreinte, 1 959 fichiers déplacés par URL, et les écarts discrets de Dokploy avec un compose lancé à la main."
pubDate: 2026-09-27
track: "infrastructure"
tags: ["dokploy", "mongodb", "docker", "backups"]
sources: ["infra/repeter-un-deploiement-sur-une-copie-de-la-base-de-production.md", "infra/migrer-un-service-compose-vers-un-orchestrateur.md", "dokploy/un-deploiement-recree-le-conteneur-et-emporte-ses-journaux.md", "dokploy/l-environnement-d-un-compose-est-chiffre-en-base.md", "dokploy/domaine-personnalise-et-url-absolues.md", "dokploy/apres-un-renommage-de-compte-github-dokploy-ne-deploie-plus.md", "infra/sauvegarde-mongodb-par-e-mail-declenchee-par-changement.md", "donnees/migrer-des-fichiers-d-un-cloud-cloudinary-a-un-autre.md", "infra/un-timer-persistent-rattrape-avant-que-les-conteneurs-soient-la.md"]
---

Le 27 septembre 2026, j'ai migré l'application mobile multilingue d'un client et son API, Nœud et MongoDB, vers un serveur géré par Dokploy, une plateforme auto-hébergée qui build à partir d'un push Git et place Traefik devant. Le projet portait une cicatrice : l'ancienne base avait disparu avec son serveur, parce que ses sauvegardes étaient écrites sur ce même serveur. La migration avait donc une règle : rien n'est supposé, chaque étape est prouvée par quelque chose que je peux lire. Trois chantiers ce jour-là : un changement qui combinait code et données, 1 959 enregistrements audio à rapatrier depuis le compte Cloudinary d'un développeur précédent, et des sauvegardes qui devaient enfin quitter le serveur.

## Répéter sur une copie de la production

Le changement avait un ordre irréversible : le code devait apprendre la notion de phrase optionnelle avant que 23 phrases soient activées en base, sinon toutes les langues disparaissaient de l'application mobile. Cinq minutes de mise en place sur le serveur : un réseau privé, un MongoDB neuf, un dump de la production restauré dedans, les secrets de l'API de production copiés depuis son conteneur, le nouveau code lancé à partir de la même image de base.

```bash
docker network create pre-net
docker run -d --name pre-mongo --network pre-net mongo:7.0
docker exec $PROD_MONGO sh -c 'mongodump … --archive --gzip' > now.archive.gz
docker exec -i pre-mongo mongorestore --gzip --archive --drop < now.archive.gz
docker exec $PROD_API env | grep -E '^(JWT_|SMTP_|CLOUDINARY_|…)' > env.list
printf 'MONGODB_URI=mongodb://pre-mongo:27017/<db>\nNODE_ENV=production\nPORT=5001\n' >> env.list
docker run -d --name pre-api --network pre-net -p <loopback>:5999:5001 --env-file env.list \
  -v <code-dir>:/app -w /app node:20-alpine \
  sh -c 'npm ci --omit=dev >/tmp/npm.log 2>&1 && node src/server.js'
```

Le port est publié sur l'adresse de loopback uniquement, et la seule différence avec la production, c'est la base de données.

Ensuite, un script de contrôle unique, `checks.sh <url> …`, qui lit ce que voient les trois publics du système, lancé trois fois : sur la répétition avec les données intactes, sur la répétition après le changement de données, sur la production après le déploiement et le changement de données. Ce jour-là : 12 langues visibles aux trois passes, 0 puis 10 phrases dans la sous-catégorie testée, et le script de données de production était exactement le fichier exécuté pendant la répétition. Des contrôles en lecture ne prouvent pas une écriture, alors j'ai terminé par un vrai geste d'utilisateur : un son d'une seconde généré avec `ffmpeg`, envoyé avec un compte de test, puis supprimé, la suppression étant vérifiée des deux côtés (base : 0, stockage : 404).

## Fichiers déplacés par URL, prouvés par la taille

`uploader.upload()` accepte une URL distante : le cloud de destination va chercher lui-même le fichier chez le cloud source. Une seule instance du SDK pilote les deux clouds, avec les identifiants passés à chaque appel, en conservant chaque `public_id`. Huit envois en parallèle, trois tentatives avec attente : 1 959 fichiers en 4 minutes, 0 échec, sur deux comptes gratuits.

Avant de toucher à la base, j'ai gardé `{url, bytes}` pour chaque envoi et comparé avec le `bytes` de la source ; seuls les enregistrements dont les tailles sont identiques des deux côtés sont repointés, soit 1 959 sur 1 959. Puis un `bulkWrite` vers le `secure_url` renvoyé, et un échantillon d'URL relues depuis la base qui répondent 200. Ce n'est qu'à ce moment que les trois variables `CLOUDINARY_*` changent ; sous Dokploy, `application.saveEnvironment` puis `application.reload` recréent le service avec le nouvel environnement sans rebuild.

## Des sauvegardes qui quittent le serveur

Une boîte mail est le stockage hors site le plus simple qui existe. La base fait 1 Mo compressée. Un cron horaire (`17 * * * *`) compare l'empreinte de la base à celle de la dernière sauvegarde envoyée, et n'envoie que si la base a changé et au plus une fois par 24 h. L'empreinte est `db.runCommand({ dbHash: 1 }).md5` : elle voit un `updateMany` direct qui ne touche aucun timestamp, ce qu'un `max(updatedAt)` aurait manqué. Deux fichiers d'état, `last_hash` et `last_sent`, portent toute la logique.

```bash
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in dump.archive.gz -out dump.archive.gz.enc \
  -pass file:<passphrase-file>
```

Le dump contient des e-mails et des hashs de mots de passe, il est donc chiffré avant de partir. Le mail passe par l'API de Resend, avec la procédure de restauration dans le corps.

Une restauration se prouve, elle ne se suppose pas : un conteneur `mongo:7.0` jetable sur `--network none`, le script de restauration pointé dessus, et l'empreinte de la base restaurée comparée à celle de la base vivante. Le 27 septembre 2026, elles étaient identiques. Un nombre de documents égal aurait prouvé le nombre ; l'empreinte prouve le contenu. Une fausse alerte le lendemain : un journal en UTC à côté d'un cron en heure locale, dernière ligne à 22:17, horloge du serveur à 00:56, et la tâche avait tourné 39 minutes plus tôt. Comparez `date` et `date -u` avant de conclure quoi que ce soit.

## Ce que la plateforme fait autrement

Les volumes. Compose préfixe les volumes nommés avec le nom du projet : déplacer un service lancé à la main sous l'orchestrateur crée donc de nouveaux volumes vides. Le service démarre parfaitement, répond 200, et ne contient rien. Trois lignes protègent les données : les noms de volumes lus dans `docker volume ls`, jamais devinés, déclarés externes.

```yaml
volumes:
  db:
    external: true
    name: myservice_db
```

Arrêtez l'ancienne stack avec `docker compose down`, jamais `-v`, et exigez une preuve positive du contenu après le déploiement.

Les journaux. Chaque push reconstruit l'image et recrée le conteneur, et `docker logs` appartient au conteneur. Le 2 octobre 2026, après trois déploiements de staging dans la même après-midi, `docker logs … --since 72h` ne contenait que les lignes de démarrage de 15:32, le dernier déploiement. La fenêtre de preuve d'un incident va du déploiement précédent au prochain push, qui est souvent le correctif. J'extrais donc les lignes avant de pousser.

L'environnement. Sur Dokploy v0.29.14, la colonne `env` d'un compose est un seul bloc base64 en trois parties séparées par `:`, soit 7 131 caractères pour un fichier de 2 774 octets et 42 clés. Une ligne ajoutée en SQL ne casse rien et ne fait rien : le déploiement se termine en `done` et le conteneur démarre avec ses 42 variables, sans la nouvelle. Une variable se définit depuis l'interface ou l'API, puis se vérifie dans le conteneur avec `docker inspect`.

Les domaines. Dokploy attribue un nom d'hôte automatique à la création et remplit la variable de domaine de l'application avec lui ; ajouter ensuite un domaine personnalisé crée les routeurs Traefik mais ne touche pas à cette variable. HedgeDoc construit un `<base>` à partir de `CMD_DOMAIN`, si bien que le navigateur récupérait chaque ressource sur l'hôte automatique, qui n'a qu'un routeur HTTP et pas de certificat, et la page arrivait nue. `curl` disait que chaque feuille de style était en 200, parce que `curl` n'applique pas `<base>` ; le journal montrait 77 affichages de page pour 3 chargements de feuilles de style. Une variable positionnée sur le domaine personnalisé, et un redéploiement.

Les webhooks. Dokploy associe un push à ses déploiements par le nom du propriétaire. Après avoir renommé mon compte GitHub le 28 septembre 2026, les clones ont été redirigés et rien n'a cassé, sauf que le serveur servait encore la 0.0.733 vingt minutes après le push de la 0.0.734 et qu'aucun journal de déploiement n'avait été ouvert. Le correctif tient en une colonne, `owner`, ou en resélectionnant le dépôt dans l'interface ; le push suivant a ouvert un journal de déploiement deux secondes plus tard.

## Le timer qui se réveille en premier

Sur un autre hôte, MongoDB tourne comme une tâche Swarm et deux timers systemd avec `Persistent=true` pilotent un dump quotidien et une capture de l'oplog toutes les 15 minutes ; chaque script refuse, exit 1, quand il ne trouve aucun conteneur Mongo. Après un redémarrage le 8 octobre à 10:15 UTC, les deux timers ont déclenché leur rattrapage à 10:15:31, les services ont démarré à 10:15:50 avec Docker actif mais la tâche Swarm pas encore recréée, et à 10:15:51 les deux ont refusé. `After=docker.service` attend le démon, pas un conteneur, et un `oneshot` en échec n'est pas relancé. La capture toutes les 15 minutes se répare au tick suivant ; le dump quotidien laisse un trou de 24 h que seul `systemctl --failed` montre. Les correctifs : `systemctl --failed` après chaque redémarrage, `Restart=on-failure` avec `RestartSec=60`, ou une attente bornée du conteneur dans le script.

## Ce que je retiens

- Un script de contrôle unique, lancé sur la répétition avant et après le changement de données, puis sur la production, et une vraie écriture à la fin.
- Une copie se prouve par les tailles et une restauration par une empreinte, jamais par « ça répond ».
- Sous un orchestrateur, les volumes sont déclarés `external` avec leurs noms observés, et les journaux sont lus avant de pousser le correctif.
- L'environnement de Dokploy, la variable de domaine et le propriétaire du webhook sont trois endroits où la vérité est dans l'interface, pas dans le fichier.
- Un timer `Persistent` se déclenche avant que les conteneurs existent ; l'unité doit échouer bruyamment et être relancée.
