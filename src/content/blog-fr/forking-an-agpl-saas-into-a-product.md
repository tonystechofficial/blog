---
title: "Ce que l'AGPL ne dit pas quand on transforme un SaaS en produit par un fork"
description: "Régie est mon fork commercial de Postiz : l'AGPL l'autorisait, mais l'interrupteur de facturation, les identifiants OAuth partagés et un chemin de webhook ont décidé s'il était vendable."
pubDate: 2026-08-14
track: "infrastructure"
tags: ["agpl", "stripe", "postiz", "saas"]
sources: ["dokploy/regie-fork-postiz-en-prod.md", "business/ce-qu-il-faut-verifier-avant-de-revendre-un-logiciel-libre.md", "../02-projects/produits/postiz-saas.md"]
---

Le 13 août 2026, j'avais une instance de Postiz qui tournait sur l'un de mes serveurs. Postiz est un planificateur de réseaux sociaux open source, sous licence AGPL-3.0. L'instance contenait 1 utilisateur, 1 organisation, 0 compte social connecté, les inscriptions désactivées et les quatre variables `STRIPE_*` vides. J'avais l'impression d'être à deux variables d'un service payant. Une demi-journée à lire le code de la v1.47.0 et la licence a dit autre chose : légalement oui, « en deux variables » non. Le lendemain, 14 août, mon fork, Régie, a remplacé l'image officielle en production, et le même jour j'ai trouvé la raison pour laquelle aucun plan n'aurait jamais été activé.

## Ce que dit la licence, et ce qu'elle ne dit pas

La licence est de l'AGPL-3.0 pure. Pas de Commons Clause, pas de clause de non-concurrence, pas de licence commerciale séparée. Revendre comme service hébergé est permis. Deux obligations vont avec. La section 13 : proposer le service sur un réseau m'oblige à offrir à chaque utilisateur le code source complet de ma version modifiée. Les prix étaient codés en dur dans la source, donc modifier était inévitable et le fork devait être publié. Je l'ai réglé avec un `/source.tar.gz` généré au build, `.git` exclu, embarqué dans l'image. Et aucune marque : l'AGPL ne donne ni le nom ni le logo. Revendre, c'est rebrander.

Le rebranding est l'endroit où la licence cesse d'aider. Le nom transparaît dans des endroits qu'un fichier de licence ne liste pas : la page de paiement, les e-mails transactionnels, le domaine de mesure d'audience, une entrée de menu. Le plus désagréable était un lien Affiliate qui n'apparaît que lorsque la facturation est active, et qui aurait envoyé mes clients payants vers le programme d'affiliation d'origine. Dans le fork : 77 chaînes visibles renommées, un logo monogramme et un favicon, témoignages et suivi d'affiliation retirés, termes en français, pages de confidentialité et de suppression des données, et les chiffres hérités « 20 000+ entrepreneurs » supprimés, vérifié à 0 occurrence en production le 18 août. Le mot « Postiz » vectorisé en chemins SVG échappe à grep : le texte du logo et le wordmark de l'aperçu ont dû être trouvés à l'œil. Un grep n'est pas un rebranding.

Certaines chaînes ne doivent jamais être renommées, parce qu'elles sont fonctionnelles. `metadata.service === 'gitroom'` filtre les événements du webhook Stripe, et l'objet d'abonnement doit porter `{billing, period, uniqueId}`. `agent="postiz"` identifie l'agent CopilotKit, et `postiz://` est le schéma de deep link. Le sujet `[Postiz]` de l'e-mail de digest vit dans un workflow Temporal déployé, et la règle du projet interdit de modifier un workflow déployé ; il attend une nouvelle version du workflow. Le paquet s'appelle toujours `gitroom` dans `package.json`.

## Le vrai interrupteur de facturation

La documentation et les résultats de recherche pointent vers `IS_GENERAL`. Le code pointe ailleurs. Le service de permissions contient un court-circuit : pas de clé de facturation, on accorde toutes les permissions, retour. L'interrupteur est `STRIPE_PUBLISHABLE_KEY`. La définir n'ajoute pas la facturation, cela retire une exemption. Dès que la clé existe, toute organisation existante tombe au palier FREE, 0 canal, 0 publication, la publication est refusée sans abonnement actif, et il n'y a pas de maintien des acquis, seulement une route de super-admin pour l'appliquer organisation par organisation. La règle que j'en ai tirée : la facturation s'active sur une nouvelle instance, jamais sur une instance vivante. `IS_GENERAL` reste, parce que sans lui le paywall du frontend disparaît. Et `!!process.env.X` est vrai pour la chaîne `"false"` : un drapeau se désactive en supprimant la variable, pas en la mettant à `false`.

Deux effets de bord voyagent avec la même clé. L'amont envoie des statistiques de visite au domaine Plausible de l'éditeur dès que la clé publiable existe, désormais en opt-in via `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`. Une notification « nouvelle agence » était câblée en dur vers l'e-mail de l'équipe amont, désormais en opt-in via `AGENCY_NOTIFICATION_EMAIL`.

Les prix étaient cinq paliers en dollars, dans la source. Régie vend à 19, 29, 39 et 89 euros par mois, avec des prix annuels de 182, 278, 374 et 854 d'après la formule amont `floor(monthly × 12 × 0.8)`. Stripe crée lui-même les produits et les prix au premier achat, il n'y a donc rien à préparer dans le dashboard.

## Les identifiants partagés décident avant le prix

Les identifiants développeur des réseaux sociaux (X, LinkedIn, Meta et les autres) sont uniques pour tout le déploiement. Chaque client publierait à travers mon enregistrement : ses quotas consomment les miens, ses conditions d'utilisation m'engagent, et un client abusif fait suspendre l'application pour tout le monde. C'est le modèle du Postiz hébergé officiel ; l'amont connaît la limite et ne l'a pas résolue (issue #975). C'est acceptable pour l'éditeur sur son propre service. Pour un revendeur, c'est la question à trancher avant tout travail de facturation : puis-je porter des clients tiers sous mon enregistrement développeur, et est-ce que je le veux ? Sinon, le produit est un déploiement par client, un autre métier et un autre prix.

Au départ, toutes les clés de fournisseurs étaient vides (`client_id=undefined`). Les clés vont dans le bloc `environment` du compose, puis `compose.update` et déploiement, et je vérifie par l'effet : l'URL OAuth doit porter un vrai identifiant. Configurés à ce jour : Mastodon, qui enregistre une application avec `POST /api/v1/apps` sans compte développeur, et Facebook et Instagram via une application Meta de type Business. Restent X, LinkedIn, YouTube et TikTok.

## Le webhook qui n'est jamais arrivé

Next 16 a renommé le middleware : c'est `proxy.ts`, pas `middleware.ts`. Il redirige tout chemin hors de sa liste blanche vers `/auth` quand il n'y a pas de cookie, donc chaque nouvelle page publique doit y être ajoutée.

Ce middleware est la raison pour laquelle aucun plan n'a jamais été activé. Le contrôleur Stripe est `@Controller('/stripe')`, mais nginx n'achemine que `/api/` vers le backend. Un webhook pointé sur `/stripe` atteignait le frontend, où `proxy.ts` répondait par un 307 vers `/auth`. Stripe ne le suit pas : `pending_webhooks` restait à 1 et l'abonnement n'arrivait jamais en base. Le bon chemin est `/api/stripe`. Un POST vide dessus renvoie 500, ce qui prouve que la route existe : le contrôleur a été atteint et a rejeté la signature. Mettre à jour l'URL de l'endpoint a conservé le même endpoint, la clé de signature est donc restée valide.

Puis un test de bout en bout le 14 août avec un compte de test isolé dans sa propre organisation FREE. `/billing/subscribe` a créé une session checkout de EUR 1900, soit 19 euros, vérifié sur l'objet Stripe. Un checkout hébergé ne peut pas être terminé sans navigateur, j'ai donc créé l'abonnement par API avec une carte de test et `metadata[service]=gitroom`, ce qui déclenche le même webhook et teste toute la chaîne sauf la saisie de la carte. Résultat : une ligne `Subscription` au palier STANDARD avec 5 canaux pour l'organisation de test, le palier STANDARD visible dans l'application, et l'abonnement ULTIMATE à vie de l'admin intact. Le lien entre abonnement et organisation est le client (`organization.paymentId`), pas le `uniqueId`.

## Six vérifications avant de promettre

La demi-journée de lecture est devenue une liste que je passe avant d'annoncer quoi que ce soit.

1. La licence permet-elle la revente ? Grep sur tout le dépôt de `commons clause`, `non-compete`, `may not sell`, `resell`, `commercial license`. Un accord de contributeur contraint l'éditeur, pas l'utilisateur. La réciprocité réseau signifie publier votre source modifiée.
2. La marque est-elle concédée ? Jamais. Trouver où elle transparaît malgré tout.
3. Quel est le vrai interrupteur de facturation ? Lire le service de permissions et trouver le court-circuit, pas le nom de la variable.
4. Que deviennent les comptes existants quand il bascule ? En général le palier par défaut, sans maintien des acquis. Nouvelle instance.
5. Les identifiants tiers sont-ils par client ou par instance ? Cela décide si c'est un SaaS tout court.
6. Qu'est-ce qui est codé en dur ? Prix, devise, noms de paliers, quotas. Codé en dur veut dire fork, et fork veut dire section 13.

Deux prérequis sortent de la liste. Le webhook est déclaré et vérifié avant la première vente, parce que l'abonnement n'est écrit en base que par lui ; sans lui, le client paie et n'obtient jamais l'accès. Et un fournisseur d'e-mail est obligatoire, sinon pas de vérification d'adresse ni de réinitialisation de mot de passe ; Resend tournait déjà sur le serveur. Et lisez le code, pas les résultats de recherche : la ligne qui porte la condition est la seule source qui tranche.

## Ce que je retiens

- L'AGPL permet la revente et exige une offre de source ; elle ne donne aucune marque, et un grep ne trouve pas un nom dessiné en chemins SVG.
- L'interrupteur de facturation est la clé publiable, et il retire une exemption ; activer sur une nouvelle instance, jamais sur une instance vivante.
- Les identifiants OAuth partagés décident si le produit est un SaaS ou un déploiement par client, avant tout prix.
- Un webhook qui reçoit un 307 n'active rien ; prouver la route avec une requête qui atteint le contrôleur.
- Les identifiants fonctionnels hérités de l'amont ne sont pas du branding ; les renommer casse la facturation, l'agent et les deep links.
