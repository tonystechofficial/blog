---
title: "Ce que coûte vraiment une session Claude Code, mesuré"
description: "Les lectures de cache font environ 96 % de la facture d'une session et la sortie environ 1,5 %, mesuré dans le transcript et confirmé par OpenTelemetry."
pubDate: 2026-08-24
track: "ai-engineering"
tags: ["claude-code", "cost", "opentelemetry", "observability"]
sources: ["claude-code/mesurer-le-cout-reel-d-une-session.md", "claude-code/travailler-sous-contrainte-de-quota.md", "observability/02-otel-data-catalog.md", "observability/04-otel-resources-sizing.md", "observability/06-otel-client-env-reference.md"]
---

## 71 lignes pour 33 appels

Le 24 août 2026, je voulais le coût réel d'une session, pas une estimation. Chaque session écrit un transcript, un objet JSON par ligne, sous `~/.claude/projects/<project-slug>/<session-id>.jsonl`. Chaque ligne `type: "assistant"` porte un objet `message.usage` avec quatre compteurs : `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` et `output_tokens`.

Le piège, c'est que le transcript écrit une entrée par bloc de contenu, pas par appel d'API. Un tour avec du texte et deux appels d'outil donne trois lignes avec le même objet `usage`, et une somme naïve double ou triple la facture. Sur cette session : 71 lignes assistant, dont 38 doublons, pour 33 appels réels. La correction consiste à dédupliquer sur `message.id` avant de sommer :

```js
const byId = new Map()
for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
  const o = JSON.parse(l)
  const u = o?.message?.usage
  if (o.type !== "assistant" || !u || byId.has(o.message.id)) continue
  byId.set(o.message.id, u)
}
```

Avec les 33 appels dédupliqués (Opus 5, contexte de 1 M), aux prix que j'utilisais ce jour-là (entrée 5 dollars le million de tokens, sortie 25 dollars, écriture du cache à 1,25 fois l'entrée, lecture du cache à 0,1 fois), la facture ressemblait à ceci :

| poste | tokens | part du coût |
|---|---|---|
| lecture du cache | 2 396 569 | ~96 % |
| écriture du cache | 99 792 | ~2,5 % |
| sortie | 26 604 | ~1,5 % |
| entrée fraîche | 66 | ~0 % |

Je ne paie presque pas ce que l'agent écrit ; je paie le fait de lui faire relire tout le contexte à chaque tour. Le nombre de tours et la taille du contexte qu'ils traînent, voilà la facture.

## Pourquoi le cache est la facture

Un cache de prompt sert le préfixe inchangé d'une conversation à une fraction du prix d'entrée, au lieu de le recalculer. Dans une boucle d'agent, le préfixe est l'historique entier, et chaque tour le renvoie. Deux conséquences, mesurées sur le même transcript.

Chaque notification de tâche en arrière-plan est un tour complet. Un moniteur qui remonte des événements coûte, par événement, la relecture de tout le contexte plus quelques centaines de tokens de sortie : environ 87 000 tokens et environ 0,054 dollar par événement, et le contexte grossit à chaque tour. À 20 événements par heure, un moniteur bavard coûte environ 1,10 dollar de l'heure et ne produit rien. Le filtre d'un moniteur ne remonte donc que ce sur quoi je peux agir : un blocage, une erreur, la fin d'un run.

Charger une skill gonfle tous les tours suivants. Une skill chargée en cours de session ajoute son contenu au contexte de façon permanente : +35 400 tokens d'un tour à l'autre, environ 0,018 dollar de plus à chaque tour restant, soit autour de 0,90 dollar sur une session qui a encore 50 tours devant elle. Je la charge donc tard, quand il reste peu de tours, plutôt que d'y renoncer.

## La même anatomie à l'échelle d'un dashboard

Via OpenTelemetry, un dashboard Grafana donne la même anatomie sur plusieurs sessions. Relevé du 29 août 2026, 8 sessions, 2 350 requêtes d'API : 864,20 dollars, 1,86 M de tokens de sortie, 182 K d'entrée fraîche, 593 M de lectures de cache. Aux prix Fable 5 de ce jour-là :

| poste | volume | prix | coût |
|---|---|---|---|
| lecture du cache | 593 M | 1,00 dollar / M | 593,00 dollars |
| écriture du cache | ~14 M (non affiché) | 12,50 dollars / M | ~176 dollars |
| sortie | 1,86 M | 50,00 dollars / M | 93,00 dollars |
| entrée fraîche | 182 K | 10,00 dollars / M | 1,82 dollar |

Le cache pèse 89 %. Repères dérivés : environ 108 dollars par session, environ 0,37 dollar par requête d'API. Sans aucun cache, les 593 M de lectures au prix plein de l'entrée auraient coûté 5 930 dollars.

Aux prix des autres modèles ce jour-là, token pour token, les mêmes volumes coûteraient environ moitié moins sur Opus 5, cinq fois moins sur Sonnet 5, dix fois moins sur Haiku 4.5, et entre 12 et 92 dollars sur GLM-5.3-Flash, toute la fourchette venant de sa remise inconnue sur les lectures de cache. Mais cette comparaison est une fiction. Un modèle plus faible en travail d'agent demande plus de tours pour le même résultat. L'unité qui tranche est le coût par tâche terminée : cinq tâches représentatives, les deux modèles, on compare les tâches menées à bien. Router par tâche avec le hook `PreModelSwitch` bat un remplacement global.

## Où va le temps

Le 12 octobre 2026, j'ai posé une autre question : comment travailler plus vite. Douze sessions, 249 Mo de transcripts, 545 tours, environ 70 heures de travail d'agent. La latence d'un appel est l'horodatage de sa dernière ligne moins celui de l'événement précédent ; son contexte est `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. La latence médiane montait avec le contexte, de 6,9 s sous 100 k tokens à 12,7 s au-delà de 700 k.

Cette lecture trompe : elle ne tient pas compte de la longueur de la réponse. Dans les gros contextes, le modèle écrivait deux fois plus (546 puis 1 080 tokens de sortie en médiane), et c'est l'écriture qui coûte du temps. Une régression `latency = a + b·context + c·output` donne +0,10 s par 100 k tokens de contexte et +9,4 s par millier de tokens écrits. Le contexte se paie en tokens, pas en temps.

En rejouant avec le contexte vidé à chaque tâche (`/clear`), en comptant 25 k tokens par tâche pour relire ce qui est perdu : le run réel a traité 4,57 milliards de tokens avec 18 compactages ; une tâche par message en traiterait 1,7 à 1,9 milliard, soit 59 à 63 % de moins, et une coupe prudente, une nouvelle tâche après chaque pause de 30 minutes, 2,0 à 2,2 milliards, soit 52 à 56 % de moins, pour environ 0,7 à 0,8 heure gagnée sur 43. Les lectures de cache représentant 89 à 96 % de la facture, la facture ou le quota baisse à peu près d'autant, et aucun compactage n'a lieu.

## La voir à travers OpenTelemetry

OpenTelemetry est le standard neutre vis-à-vis des fournisseurs pour émettre métriques, logs et traces, et Claude Code émet les trois. Avec `OTEL_METRICS_EXPORTER=otlp`, il envoie des métriques sans contenu, parmi lesquelles `claude_code.token.usage`, `claude_code.cost.usage`, `claude_code.session.count` et `claude_code.active_time.total`. Les drapeaux de contenu, de `OTEL_LOG_USER_PROMPTS` à `OTEL_LOG_RAW_API_BODIES`, sont opt-in et placent du vrai texte, secrets compris, dans le backend.

Côté client, c'est un bloc de variables d'environnement, profil consommation seule :

```bash
CLAUDE_CODE_ENABLE_TELEMETRY=1
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.<domain>
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64 user:pass>
OTEL_RESOURCE_ATTRIBUTES=device=<machine-name>
```

Le backend est une stack LGTM auto-hébergée : l'image `grafana/otel-lgtm` réunit Grafana, Prometheus, Loki et Tempo dans un seul conteneur, que je fais tourner comme service Compose sur Dokploy, derrière Traefik avec un certificat Let's Encrypt. Dimensionnement par profil :

| profil | RAM | vCPU | disque | rétention |
|---|---|---|---|---|
| métriques seules | 1 à 2 Go | 1 | 5 à 10 Go | 30 j |
| + événements sans contenu | 2 Go | 1 à 2 | 10 à 20 Go | 14 à 30 j |
| + contenu + traces | 3 à 4 Go | 2 | 40+ Go, croît vite | 14 j |

Le minimum viable est un VPS de 2 Go, 1 vCPU, 20 Go de SSD. La rétention est le premier levier sur le disque ; ne pas journaliser le contenu est le second.

## Travailler sous quota

Quand la contrainte est le quota plutôt que la facture, les limites se rechargent sur une fenêtre glissante : un dépassement coûte des heures d'attente, pas le projet. `/usage` donne l'état réel et l'heure de recharge, donc je le regarde avant de rationner quoi que ce soit. Ensuite je séquence au lieu de rationner : les tâches se divisent en coût zéro (appels, réunions, décisions, lecture) et coût en tokens (écrire et déboguer du code), et je garde une file non vide de tâches à coût zéro vers lesquelles basculer quand le quota tombe.

Ce qui vide un quota n'est presque jamais le code produit. Trois fuites, par rendement : un document de référence trop gros (un plan de projet de 77 Ko, c'est environ 25 000 tokens rechargés à chaque session ; mieux vaut en extraire un `CLAUDE.md` de quelques kilo-octets), les boucles d'exploration (déboguer un déploiement ou une configuration coûte bien plus que les fonctionnalités ; une session de spécification préalable fait des suivantes de l'exécution), et l'échafaudage délégué à l'agent (du copier-coller depuis la documentation, gratuit quand je le fais moi-même).

## Ce que je retiens

- Dédupliquer sur `message.id` avant de sommer un transcript, sinon la facture double.
- Les lectures de cache font 89 à 96 % du coût. Les tours et la taille du contexte sont la facture, pas la longueur des réponses.
- Chaque notification en arrière-plan est un tour complet ; une skill chargée taxe tous les tours qui suivent.
- Le contexte coûte des tokens, pas du temps : 0,1 s par 100 k. Un `/clear` par tâche économise 52 à 63 % des tokens.
- Comparer les modèles au coût par tâche terminée, jamais token pour token.
