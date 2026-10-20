---
title: "Moving a production app to a self-hosted PaaS without losing a byte"
description: "A rehearsal on a copy of production, backups proven by fingerprint, 1,959 files moved by URL, and the ways Dokploy quietly differs from a hand-run compose."
pubDate: 2026-09-27
track: "infrastructure"
tags: ["dokploy", "mongodb", "docker", "backups"]
sources: ["infra/repeter-un-deploiement-sur-une-copie-de-la-base-de-production.md", "infra/migrer-un-service-compose-vers-un-orchestrateur.md", "dokploy/un-deploiement-recree-le-conteneur-et-emporte-ses-journaux.md", "dokploy/l-environnement-d-un-compose-est-chiffre-en-base.md", "dokploy/domaine-personnalise-et-url-absolues.md", "dokploy/apres-un-renommage-de-compte-github-dokploy-ne-deploie-plus.md", "infra/sauvegarde-mongodb-par-e-mail-declenchee-par-changement.md", "donnees/migrer-des-fichiers-d-un-cloud-cloudinary-a-un-autre.md", "infra/un-timer-persistent-rattrape-avant-que-les-conteneurs-soient-la.md"]
---

On 27 September 2026 I moved a client's multilingual mobile app and its API, Node and MongoDB, to a server managed by Dokploy, a self-hosted platform that builds from a Git push and puts Traefik in front. The project came with a scar: the previous database had disappeared with its server, because its backups were written on that same server. So the move had one rule: nothing is assumed, every step is proven by something I can read. Three jobs that day: a change that combined code and data, 1,959 audio recordings to bring back from a previous developer's Cloudinary account, and backups that had to leave the server this time.

## Rehearse on a copy of production

The change had an order that could not be reversed: the code had to learn the notion of an optional phrase before 23 phrases were activated in the database, or every language would have vanished from the mobile app. Five minutes of setup on the server: a private network, a fresh MongoDB, a dump of production restored into it, the production API's secrets copied from its container, the new code started from the same base image.

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

The port is published on the loopback address only, and the one difference with production is the database.

Then one control script, `checks.sh <url> …`, reading what the three audiences see (the mobile app, the admin page, the speaker's screen), run three times: on the rehearsal with intact data, on the rehearsal after the data change, on production after deployment and data change. That day: 12 languages visible on all three passes, 0 then 10 phrases in the tested subcategory, and the production data script was the very file run in the rehearsal. Read checks do not prove a write, so I finished with a real user gesture: a one-second sound generated with `ffmpeg`, uploaded with a test account, then deleted, with the deletion verified on both sides (database: 0, storage: 404).

## Files moved by URL, proven by size

`uploader.upload()` accepts a remote URL: the destination cloud fetches the file from the source cloud itself. One SDK instance drives both clouds with credentials passed per call, keeping each `public_id`. Eight uploads in parallel, three attempts with a wait: 1,959 files in 4 minutes, 0 failures, on two free accounts.

Before touching the database I kept `{url, bytes}` for every upload and compared with the source's `bytes`; only records with identical sizes on both sides get repointed, 1,959 of 1,959. Then a `bulkWrite` to the returned `secure_url`, and a sample of URLs read back from the database answering 200. Only then do the three `CLOUDINARY_*` variables change; under Dokploy, `application.saveEnvironment` then `application.reload` recreates the service with the new environment without a rebuild.

## Backups that leave the server

A mailbox is the simplest off-site storage there is. The base is 1 MB compressed. An hourly cron (`17 * * * *`) compares the database fingerprint with that of the last backup sent, and sends only if the base changed and at most once per 24 h. The fingerprint is `db.runCommand({ dbHash: 1 }).md5`: it sees a direct `updateMany` that touches no timestamp, which a `max(updatedAt)` would have missed. Two state files, `last_hash` and `last_sent`, hold the whole logic.

```bash
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in dump.archive.gz -out dump.archive.gz.enc \
  -pass file:<passphrase-file>
```

The dump holds e-mails and password hashes, so it is encrypted before leaving. The mail goes through Resend's API with the restore procedure in the body.

A restore is proven, not assumed: a throwaway `mongo:7.0` container on `--network none`, the restore script pointed at it, and the fingerprint of the restored base compared with the live one. On 27 September 2026 they were identical. An equal document count would have proven the number; the fingerprint proves the content. One false alarm the next day: a log in UTC next to a cron in local time, last line at 22:17, server clock at 00:56, and the job had run 39 minutes earlier. Compare `date` and `date -u` before concluding anything.

## What the platform does differently

Volumes. Compose prefixes named volumes with the project name, so moving a hand-run service under the orchestrator creates new, empty volumes. The service starts perfectly, answers 200, and contains nothing. Three lines protect the data: the volume names read from `docker volume ls`, never guessed, declared external.

```yaml
volumes:
  db:
    external: true
    name: myservice_db
```

Stop the old stack with `docker compose down`, never `-v`, and demand a positive proof of content after the deploy.

Logs. Each push rebuilds the image and recreates the container, and `docker logs` belongs to the container. On 2 October 2026, after three staging deployments in one afternoon, `docker logs … --since 72h` held only the startup lines of 15:32, the last deployment. The evidence window of an incident runs from the previous deployment to the next push, which is often the fix. So I extract the lines before pushing.

Environment. On Dokploy v0.29.14 the `env` column of a compose is a single base64 block in three parts separated by `:`, 7,131 characters for a file of 2,774 bytes and 42 keys. A line appended by SQL breaks nothing and does nothing: the deployment ends in `done` and the container starts with its 42 variables, without the new one. A variable is set from the interface or the API, then checked inside the container with `docker inspect`.

Domains. Dokploy assigns an automatic hostname at creation and fills the application's domain variable with it; adding a custom domain later creates the Traefik routers but leaves that variable alone. HedgeDoc builds a `<base>` from `CMD_DOMAIN`, so the browser fetched every asset on the automatic host, which has only an HTTP router and no certificate, and the page arrived naked. `curl` said every stylesheet was 200, because `curl` does not apply `<base>`; the log showed 77 page views for 3 stylesheet loads. One variable set to the custom domain, and a redeploy.

Webhooks. Dokploy matches a push to its deployments by the owner's name. After I renamed my GitHub account on 28 September 2026, clones were redirected and nothing broke, except that the server still served 0.0.733 twenty minutes after the push of 0.0.734 and no deployment log had been opened. The fix is one column, `owner`, or reselecting the repository in the interface; the next push opened a deployment log two seconds later.

## The timer that wakes up first

On another host, MongoDB runs as a Swarm task and two systemd timers with `Persistent=true` drive a daily dump and an oplog capture every 15 minutes; each script refuses, exit 1, when it finds no Mongo container. After a reboot on 8 October at 10:15 UTC, both timers fired their catch-up at 10:15:31, the services started at 10:15:50 with Docker active but the Swarm task not yet recreated, and at 10:15:51 both refused. `After=docker.service` waits for the daemon, not for a container, and a failed `oneshot` is not retried. The 15-minute capture heals itself at the next tick; the daily dump leaves a 24 h hole that only `systemctl --failed` shows. The fixes: `systemctl --failed` after every reboot, `Restart=on-failure` with `RestartSec=60`, or a bounded wait for the container in the script. Never remove the refusal: a script that exits 0 without saving anything is worse than a failed unit.

## What I keep

- One control script, run on the rehearsal before and after the data change, then on production, and a real write at the end.
- A copy is proven by sizes and a restore by a fingerprint, never by "it responds".
- Under an orchestrator, volumes are declared `external` with their observed names, and logs are read before the fix is pushed.
- Dokploy's environment, domain variable and webhook owner are three places where the interface, not the file, is the truth.
- A `Persistent` timer fires before the containers exist; the unit must fail loudly and be retried.
