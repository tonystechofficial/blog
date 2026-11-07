---
title: "Un dépôt freelance dont le plugin Tailwind exécute un payload distant"
description: "Un projet Next.js d'allure propre, issu d'une annonce freelance, exécutait du code distant au npm run dev. Le chargeur se cachait dans la config CSS, derrière un paquet que npm audit ne voit pas."
pubDate: 2026-10-23
track: "security"
tags: ["security", "supply-chain", "npm", "malware", "freelance"]
sources: ["securite/depot-d-entretien-piege-chargeur-distant-dans-un-plugin-tailwind.md"]
---

## Une mission comme les autres

Le 23 octobre 2026, une annonce sur une place de marché française du freelance cherchait un développeur full-stack pour « finaliser et préparer pour la production » un SaaS de mode par IA : les utilisateurs essaient des vêtements virtuellement, Next.js 16, Prisma, NextAuth, Stripe. Le client partageait un dépôt GitHub privé pour démarrer. Je l'ai cloné et j'ai lancé ce que tout le monde lance : `npm install && npm run dev`.

Tout paraissait normal. Un README soigné, une liste crédible de « problèmes connus », un `.env.example` déjà rempli de clés de test « pour démarrer vite ». Ce dernier détail est l'appât : un projet qui fonctionne tout de suite est un projet qu'on lance sans le lire.

C'est le mode opératoire de la campagne connue sous le nom de Contagious Interview, publiquement attribuée à des opérateurs nord-coréens et suivie sous les noms BeaverTail et InvisibleFerret. La version habituelle est un faux recruteur qui demande à un candidat de « lancer et corriger » un dépôt pendant un processus d'embauche. Ici, l'appât était une mission freelance, soit la même ruse visant une population qui clone du code de clients pour gagner sa vie.

## La chaîne passe par la config CSS

Pas de script `postinstall`, rien dans `package.json` qu'une relecture rapide signale. Le chemin d'exécution est le suivant :

1. `tailwind.config.ts` charge un plugin, `tailwindcss-visual-kit`, présenté comme une surcouche d'Animate.css.
2. Ce plugin dépend de `@jasperquinn/postcss-motion-helpers`, un paquet scopé publié en accès restreint. Il ne s'installe que parce que le dépôt commite un `.npmrc` qui contient un jeton d'authentification npm.
3. À l'intérieur, `src/config.js` pèse 181 Ko sur une seule ligne obfusquée. Une fonction appelée `normalizeOptions()` lance une boucle en arrière-plan de dix tentatives : elle envoie un POST à un serveur sur le port 1224, sur `/debugCheck`, décode en base64 le champ `message` de la réponse, et l'exécute avec `new Function('require', code)(require)`. L'adresse du serveur est elle-même cachée en base64, découpée et mélangée.
4. Tailwind évalue sa config à chaque compilation du CSS. Donc `npm run dev`, `next build` ou un simple `npx tailwindcss` lancent tous le chargeur. `npm install --ignore-scripts` ne protège de rien ici.

Deux détails de plus le rendent robuste. L'unique commit malveillant a ajouté des scripts `predev` et `prestart` qui suppriment `.next`, de sorte qu'il n'y a jamais de cache et que la config est réévaluée à chaque lancement. Et `config.js` vérifie la présence de drapeaux `--inspect` dans `process.execArgv` et de variables d'environnement liées à l'analyse, pour se comporter autrement sous un débogueur.

## Pourquoi les scanners ne disent rien

Le plugin public ne contient que du code propre. Le payload vit dans la sous-dépendance restreinte, qui répond 404 à toute requête anonyme : je l'ai revérifié le 24 octobre, le plugin est toujours listé sur npm et la sous-dépendance est toujours invisible. Cela signifie que `npm audit`, Socket, Snyk, et quiconque lit le registre sans le jeton, ne voient rien d'anormal. Le jeton dans le dépôt n'est pas une erreur de l'attaquant. C'est le mécanisme de livraison.

L'historique raconte la même chose. Le plugin a été publié le 9 octobre, d'abord en `0.0.0-stage`, puis en `1.3.6` deux minutes plus tard, un numéro de version choisi pour paraître mûr. Le commit malveillant est arrivé l'après-midi même, intitulé « Refactor code structure for improved readability », depuis un compte vieux de quelques mois. Les commits précédents, datés de mai, ressemblent à un vrai projet qui a été repris et armé. L'organisation GitHub qui l'héberge avait trois jours quand le plugin a été mis en ligne, et les dépôts sources déclarés dans les deux `package.json` n'existent pas.

## Il s'est exécuté

Le signe a été une ligne dans la sortie du serveur de dev : `ps: unknown option -- o`. Aucun paquet installé n'appelle `ps`. C'était le payload téléchargé qui listait les processus. Un instant plus tard, Turbopack a planté son worker PostCSS et toutes les pages répondaient 500.

Le serveur, consulté uniquement par des sources passives et jamais contacté : un VPS sans DNS inverse chez un hébergeur qui revient régulièrement dans les rapports sur des infrastructures étatiques, sous Ubuntu, nginx, et Node.js/Express sur le port 1224. Cette pile est la forme habituelle d'un serveur de commande BeaverTail.

Le soir même, j'ai posté un avertissement sur le Discord communautaire de la place de marché, dans le canal où les freelances comparent leurs impressions sur les annonces douteuses. En substance : ce projet est une attaque conçue pour collecter des secrets (clés SSH, fichiers `.env`, clés de portefeuilles, cookies de navigateur), et le dépôt privé qu'ils partagent tire `tailwindcss-visual-kit` et `@jasperquinn/postcss-motion-helpers`, qui sont le malware. Un autre freelance m'a remercié dans la demi-heure. C'est la défense la moins chère et la plus rapide qui soit : le prochain freelance le lit avant de cloner.

## Les signaux avant d'installer

- Un `.npmrc` avec un jeton d'authentification dans un dépôt qu'on vous remet. Il n'existe aucune raison légitime pour cela.
- Un plugin CSS ou PostCSS peu connu, avec des auteurs différents sur le plugin et sur sa sous-dépendance, et un paquet scopé restreint dans l'arbre.
- Un fichier « config » ou « options » de plusieurs dizaines de kilo-octets sur une seule ligne.
- `fetch`, `new Function`, `eval` ou `Buffer.from(..., 'base64')` dans du code censé transformer du CSS.
- Un `.env.example` plein de clés d'allure réelle, là pour vous faire lancer sans réfléchir.
- Le port 1224 (ainsi que 1244 et 1245) : la signature des serveurs BeaverTail.

Une vérification qui n'exécute rien : faire un grep des paquets inconnus dans `node_modules` pour `new Function|eval\(|child_process`, et lire le `package.json` de chaque dépendance directe que vous ne reconnaissez pas. Mieux : n'exécuter un dépôt reçu d'un inconnu, recruteur ou client, que dans une VM ou un conteneur jetable sans aucun secret monté.

## Une fois qu'il s'est exécuté

- Tuer l'arbre de processus ne suffit pas. Le payload a eu le temps de lire le disque. Les variantes connues prennent les mots de passe et cookies du navigateur, les extensions de portefeuille (MetaMask, Phantom), les fichiers `.env`, les clés SSH et le contenu de `~/.config`. Certaines installent une porte dérobée en Python ou une entrée de persistance.
- Ne pas contacter le serveur de commande pour « voir ce qu'il renvoie ».
- Considérer comme exposé tout secret lisible par votre utilisateur, et faire la rotation depuis une autre machine, saine. Un keylogger rend inutile une rotation faite depuis la machine infectée.
- Conserver le dépôt et `node_modules` comme preuves pour les signalements.

Signaler d'abord ce qui coupe la distribution : npm (le lien « Report malware » sur la page du paquet, les deux paquets, le compte éditeur, et le jeton en privé uniquement), GitHub (le dépôt, l'organisation, le commit), et une issue sur OpenSSF `malicious-packages`, la base qui alimente OSV, Socket et Snyk. Ensuite l'adresse d'abuse de l'hébergeur, la plateforme où le premier contact a eu lieu, et en France cybermalveillance.gouv.fr. Un dépôt de plainte compte quand il y a une perte réelle, comme des fonds ou des comptes volés.

## Ce que je retiens

- Un serveur de dev est un environnement d'exécution. Tout ce que votre outil de build évalue, configs Tailwind et PostCSS comprises, s'exécute avec vos droits.
- `--ignore-scripts` ne couvre que les hooks d'installation. Un chargeur dans un fichier de config passe à côté sans encombre.
- Un jeton dans un `.npmrc` que vous n'avez pas écrit est en soi un signal d'alarme : c'est ainsi qu'un payload se cache de tous les scanners publics.
- Clonez le code des inconnus dans quelque chose que vous pouvez jeter. La machine qui détient vos clés n'est pas un banc d'essai.
- Prévenez la communauté là où l'appât a été posté. Cela coûte un message, et il atteint la prochaine personne avant l'attaquant.
