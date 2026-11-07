---
title: "Un scanner Polymarket dimensionné pour dix millisecondes de CPU"
description: "Le plan gratuit de Cloudflare donne 10 ms de CPU et 50 sous-requêtes à un cron. J'ai dimensionné un scanner Polymarket en lecture seule sur ce budget et mesuré ce que la doc ne dit pas."
pubDate: 2026-10-21
track: "onchain"
tags: ["polymarket", "cloudflare-workers", "d1", "workers-ai", "free-tier", "prediction-markets"]
sources: ["infra/scanner-planifie-dans-le-plan-gratuit-cloudflare-workers-d1-workers-ai.md", "defi/polymarket-api-publique-lecture-gamma-clob-frais-geoblocage.md", "node/tsc-epuise-la-memoire-sur-un-generique-zod-4-et-deux-copies-de-zod.md"]
draft: false
---

## Le budget est de dix millisecondes, pas de dix secondes

Le 21 octobre 2026, j'ai construit un scanner des marchés Polymarket qui doit coûter zéro par mois : un Worker Cloudflare sur un déclencheur cron, une base D1, Workers AI pour une lecture structurée des règles de résolution, et un tableau de bord statique servi par le même Worker. En lecture seule, en simulation uniquement, aucun portefeuille nulle part. Le code est open source sur github.com/tonystechofficial/polymarket-edge-scanner.

Avant d'écrire une ligne, j'ai recopié les limites de la documentation, car elles sont la conception. Une invocation Workers Free dispose de 10 ms de CPU, et une exécution de cron est une invocation. Elle dispose de 50 sous-requêtes et de 50 requêtes D1. Une requête D1 accepte au plus 100 paramètres liés. Workers AI offre 10 000 neurons par jour et échoue, plutôt que de facturer, au-delà. Les requêtes d'assets statiques sont gratuites et illimitées, ce qui explique que le tableau de bord soit un dossier de fichiers et non une page rendue côté serveur.

Dix millisecondes de CPU excluent tout ce qui ressemble à un job. Chaque exécution fait une seule chose : une découverte (une requête Gamma, 24 marchés conservés au plus) ou une tranche de tarification (une requête CLOB pour 8 marchés, 16 carnets d'ordres), puis une vérification de résolution, puis au plus un appel au modèle. Le curseur vit dans D1, le verrou est un simple upsert avec une clause `WHERE value < now`, et chaque budget est compté pour qu'une exécution s'arrête d'elle-même avant que la plateforme ne le fasse. La première version écrivait 24 marchés avec 24 instructions et touchait le plafond de 50 requêtes ; quatre lignes par instruction le gardent sous 40.

## Polymarket publie les frais par marché

Rien ici n'exige de clé. Le `/events` de Gamma renvoie les marchés d'un événement avec leurs tags en une seule requête, donc la catégorie vient gratuitement. Les champs qui ressemblent à des tableaux sont des chaînes JSON. Chaque marché porte un `feeSchedule` : le 21 octobre, un match de NBA avait un taux taker de 0, un marché d'élection brésilien 0,04, un marché quotidien du Bitcoin 0,07, avec la formule officielle `shares × rate × p(1−p)`. Le `takerBaseFee: 1000` à côté ne se convertit pas en ce taux, donc le barème est la source et 0,07 l'hypothèse quand il manque.

Le `POST /books` du CLOB tarifie cent tokens en une requête, niveaux triés du pire au meilleur. Une mesure a changé la stratégie : le carnet NO est le miroir du carnet YES. J'ai lu YES à 0,67 / 0,68 et NO à 0,32 / 0,33 sur le même marché. Donc « ask YES plus ask NO inférieur à un » ne peut pas arriver dans un instantané cohérent, et quand cela apparaît, cela signifie que les deux carnets ont été lus à des moments différents. Le seul avantage structurel qui reste se trouve entre les issues d'un événement à risque négatif, quand les asks YES de toutes les issues somment à moins d'un après frais, et le scanner ne le simule que lorsque l'ensemble des issues se trouve dans le même lot.

Le scanner appelle aussi le point d'accès officiel de géoblocage et affiche la réponse au lieu de la contourner. Depuis ma machine, la réponse était bloquée, pays NL. Depuis la sortie du Worker, elle était bloquée, pays NL également. Trader est de toute façon impossible dans ce build ; l'affichage est là pour que personne ne se pose la question.

## Le modèle de la page JSON mode était déprécié depuis cinq mois

J'ai choisi `@cf/meta/llama-3.1-8b-instruct` parce que la page JSON mode de la documentation le liste. Le premier appel en production a répondu par l'erreur 5028 : déprécié le 2026-05-30. Rien avant l'appel ne le dit. Le scanner a survécu comme prévu, a écrit une ligne d'erreur et a continué, et verrouille désormais un modèle signalé comme déprécié pour qu'il ne soit plus appelé tant que la configuration ne change pas.

Quatre candidats en service, même prompt, même schéma JSON, mesurés sur le Worker déployé :

| Modèle | JSON valide | Neurons par appel | Durée réelle de l'exécution |
| --- | --- | --- | --- |
| llama-3.1-8b-instruct-fp8-fast | 4 sur 4 | 7,8 à 13,7 | 1,1 à 2,3 s |
| granite-4.0-h-micro | 4 sur 4 | 2,6 à 3,7 | 5,0 à 9,1 s |
| qwen3-30b-a3b-fp8 | 0 sur 1 | 15,8 à 17,3 | 3,4 à 4,5 s |
| gpt-oss-20b | 0 sur 1 | 24,9 | 5,2 s |

Les deux modèles de raisonnement ont dépensé tout leur budget de sortie de 450 tokens à réfléchir et n'ont renvoyé aucun JSON. Les modèles plus récents répondent aussi dans l'enveloppe OpenAI, `choices[0].message.content`, avec `response` à null, donc un parseur écrit pour l'ancienne forme `{ response }` en a rejeté trois sur quatre avant même que le schéma ne les voie. À 60 appels par jour, le modèle par défaut consomme moins de 10 % des neurons gratuits.

Le modèle est encadré : il lit la question et les règles de résolution, doit renvoyer un schéma, et une garde met à null toute probabilité qui arrive sans deux éléments de preuve, une source et des données fraîches. Sur 17 exécutions, chaque analyse est revenue avec une probabilité nulle et `INSUFFICIENT_EVIDENCE`, ce qui est la bonne réponse pour un modèle sans accès au web qui lit une question sur le futur.

## Ce que les premières exécutions en production ont mesuré

Sans identifiant Cloudflare sur la machine, `wrangler deploy --temporary` crée un compte de prévisualisation que l'on peut réclamer depuis un lien valable 59 minutes. La création de D1, les migrations, le déploiement et un secret acceptent tous ce drapeau. La seule limite qui diffère d'un compte gratuit normal est 0 déclencheur cron, donc les exécutions ci-dessous étaient manuelles.

Le démarrage du Worker a pris 17 ms. Une exécution de découverte a lu 20 événements, conservé 24 marchés, rejeté 210 avec un motif (100 clos, 108 inactifs, 2 au-delà de leur date de fin), utilisé 2 sous-requêtes et 448 ms de durée réelle. Une exécution de tarification a lu 16 carnets en 1 sous-requête et écrit 8 signaux en 581 ms. Les 17 exécutions se sont terminées en `ok`, avec au plus 2 sous-requêtes chacune. Les 25 signaux de valeur ont tous été rejetés avec `INSUFFICIENT_EVIDENCE` : l'estimateur ne parle que lorsqu'une tranche de prix contient 30 marchés résolus qu'il a lui-même observés, et un déploiement tout neuf n'en a aucun. C'est l'état honnête d'un modèle de valeur au premier jour, et le tableau de bord le dit à côté de chaque signal.

## Une seule signature générique a coûté six gigaoctets

La vérification de types de l'espace de travail a tourné 80 secondes et est morte faute de mémoire à 6 Go. Une bissection par `include`, quatre configs jetables en parallèle, a désigné un paquet en dix minutes. La cause était `fetchJson<T>(url, schema: ZodType<T>)` : avec zod 4, l'inférence de `T` à travers les entrailles du schéma ne se termine pas en pratique, et une seconde copie de zod imbriquée sous les paquets (4.6.5 épinglée à la racine par le plugin Vitest de Cloudflare, 4.6.7 demandée par les paquets) a poussé le compilateur à comparer deux arbres de types identiques. Contraindre sur le schéma, `S extends ZodType<any, any>` avec `z.output<S>`, et ne garder qu'une version a ramené les mêmes 359 fichiers à 0,85 s et 205 Mo.

## Ce qu'il reste

Le déploiement sur mon propre compte attend un clic dans le navigateur sur le consentement OAuth de Cloudflare ; les scripts qui suivent sont testés. La table de calibration est vide tant que les marchés ne se résolvent pas, donc les premières semaines ne produiront que des rejets, et la comparaison avec la référence implicite du marché n'aura de sens qu'après. Les chiffres ci-dessus sont des mesures d'une plateforme et d'un premier modèle, pas un résultat sur Polymarket.
