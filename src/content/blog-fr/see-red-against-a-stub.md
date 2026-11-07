---
title: "Voir rouge contre un stub, pas contre un module manquant"
description: "Un test écrit avant le code échoue d'abord sur un import manquant, avec zéro test exécuté. Le rouge qui prouve quelque chose, c'est 13 échecs sur 13 contre un stub."
pubDate: 2026-08-24
track: "ai-engineering"
tags: ["testing", "claude-code", "tdd", "verification"]
sources: ["apprentissage/voir-le-rouge-contre-un-stub.md", "apprentissage/voir-le-rouge-apres-coup-en-desactivant-la-garde.md", "apprentissage/un-negatif-nest-pas-une-reponse.md", "defi/une-sortie-vide-n-est-pas-un-succes.md", "node/execsync-sous-windows-un-controle-qui-ne-lit-rien-repond-ok.md", "node/jest-une-suite-qui-n-a-pas-tourne-ne-se-voit-pas-dans-un-grep.md", "apprentissage/un-garde-qui-ne-couvre-quun-chemin.md"]
---

## Le rouge qui ne prouve rien

La règle permanente que je donne à mon agent de code est courte. Quand le code est de la logique métier, une fonction qui décide quelque chose à partir de ses entrées, sans base de données, réseau ni interface, écrire d'abord le test qui échoue, le lancer pour le voir échouer, puis écrire le code qui le fait passer. Voir le rouge n'est pas une formalité : un test jamais vu en échec peut passer pour une raison sans rapport avec ce qu'il est censé vérifier, et un contrôle que je crois vivant est plus dangereux qu'un contrôle que je sais absent. Hors logique métier, je ne l'impose pas. Sur un défaut observé, le test reproduit le défaut avant la correction, et les mesures avant et après vont dans le message de commit.

Quand c'est un agent qui écrit le code, cette règle a un point faible que je n'ai vu qu'en le regardant travailler. L'agent écrit le test, le lance, annonce le rouge, écrit le code, annonce le vert. Mais le premier rouge est presque toujours celui-ci :

```
Cannot find module './backupStaleness' from 'backupStaleness.test.js'
Tests: 0 total
```

Zéro test exécuté. Le fichier n'a jamais été chargé, donc pas une seule assertion n'a été évaluée. Ce rouge dit une seule chose, « le module n'existe pas », que je savais déjà. Il ne dit rien de ce qui compte : mes assertions discriminent-elles quoi que ce soit ? Le vert qui suit est un vert que je n'ai jamais vu rouge, exactement le trou que la règle devait combler.

## Le rouge qui compte

Le 24 août 2026, j'ai changé la séquence. Avant que le test ne tourne pour la première fois, l'agent écrit un stub qui compile et ne décide rien : la forme de retour attendue, avec des valeurs constantes.

```js
export function backupVerdict() {
  return { status: 'ok', reason: null, drift: 0, remaining: 0 };
}
```

Puis le test tourne contre lui, et cette fois les assertions s'exécutent. Le décompte est lisible :

```
Tests: 13 failed, 13 total
```

Treize sur treize. Chaque assertion voit un écart entre une réponse constante et la réponse attendue ; aucune ne passe par hasard. Cette mesure autorise l'écriture du code, et une fois le vert obtenu, autorise à croire le vert.

Le décompte parle aussi quand il n'est pas complet. Sur un second module, le stub a donné `2 failed, 1 passed`. L'assertion verte était :

```js
expect(encodeSnapshot(releve)).not.toMatch(/[&=]/);
```

Le stub renvoyait `"stub"`, qui ne contient ni `&` ni `=`. L'assertion passe sur une implémentation vide, donc seule elle ne prouve rien. Ce n'est pas forcément un défaut, un test d'aller-retour voisin porte la charge ici, mais j'ai besoin de le savoir, et seul le décompte contre le stub le montre. Une assertion qui reste verte contre le stub est soit couverte par une autre, soit décorative.

## Pourquoi un vert a besoin d'un témoin

En dessous, il y a une asymétrie que j'applique maintenant partout. Un positif se valide lui-même : si l'outil trouve la chose, la chose existe. Un négatif ne prouve rien tant que l'instrument n'est pas prouvé. « Rien trouvé » recouvre deux états : la chose n'existe pas, ou je n'ai pas cherché au bon endroit ou de la bonne façon. « Le test passe » est un négatif déguisé : il affirme l'absence d'un défaut, et il ne vaut quelque chose que si le test peut échouer.

Deux lectures d'une même journée, le 11 août 2026 : « 10 test suites failed, 0 tests » venait du mauvais lanceur de tests, le projet avait le sien ; « `ethers.Interface is not a constructor` » venait d'un dépôt sous ethers v5 avec l'API v6 écrite de mémoire. Aucun des deux n'était un défaut du code. Chaque fois, la source canonique, `package.json`, le type, le corps de la fonction, était à un pas, et une approximation accessible l'a emporté.

## Voir le rouge après coup

Parfois la garde existe avant son test. Le test écrit après passe dès le premier lancement et rien ne dit qu'il vérifie quoi que ce soit. Je ne réécris pas le test. Je désactive la garde.

1. Sauvegarder le fichier de production au niveau de l'octet, chemin absolu, calculé une seule fois.
2. Neutraliser seulement la garde visée : `if (guard)` devient `if (false && guard)`, un filtre retiré, un index rendu non unique. Compter l'occurrence modifiée pour confirmer que la mutation a pris.
3. Lancer uniquement ce test. Il doit échouer, avec le message attendu.
4. Restaurer depuis la sauvegarde, jamais en rééditant, puis `cmp` entre le fichier et la sauvegarde.
5. Relancer : vert.

Mesuré le 30 septembre 2026 sur cinq gardes d'un circuit de paiement (un filtre de veto contre un vrai MongoDB, un index unique, une branche d'incident inconnu, une reprise de réservation, un clic non confirmé) : chacune a fait passer son test au rouge une fois neutralisée, l'index unique deux fois en deux essais. Rééditer pour restaurer peut laisser un écart invisible, une fin de ligne ou une espace, d'où la sauvegarde et le `cmp`.

## Un contrôle silencieux n'est pas un contrôle qui passe

La même asymétrie mord hors des tests, trois fois en deux semaines.

Le 23 septembre 2026, l'agent a validé un changement de type avec `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "error TS" | head -8`, suivi d'un echo annonçant que vide voulait dire build propre. Rien ne s'est affiché ; verdict, propre. Faux. Sans le filtre, la sortie était `npm error code EOVERRIDE` : npx s'était arrêté sur un conflit de dépendances avant même d'appeler tsc. Le binaire local, `./node_modules/.bin/tsc --noEmit`, sortait en 0 et le pensait. Un filtre transforme toute défaillance en amont en silence. Je lis donc le code de sortie (`cmd; echo "exit=$?"`), je préfère le binaire local à un lanceur, et j'exige une preuve positive, un compte ou une ligne qui dit N tests passés.

Le 28 septembre, un contrôle de pre-commit sur deux dApps répondait « OK, no i18n catalogue detected » depuis quatre jours. Il trouvait ses fichiers avec `execSync('grep -rl … 2>/dev/null || true')`, écrit et vérifié sous Linux ; le 24, le travail était passé sous Windows. `execSync` avec une chaîne ouvre le shell par défaut de la plateforme, cmd.exe sous Windows. cmd.exe ne connaît pas `/dev/null`, la commande échouait avant que grep ne renvoie quoi que ce soit, `|| true` effaçait l'échec, et le script lisait « aucun fichier », affichait OK et sortait en 0. Remplacé par un parcours d'arborescence en Nœud, le même contrôle a lu 2 catalogues et vérifié 106 clés sur une dApp, 9 fichiers et 86 clés sur l'autre. Aucun placeholder brut n'avait été livré pendant ces quatre jours, ce que je sais après coup, pas par garantie. Un script de vérification n'appelle pas de shell ; s'il le doit, il échoue quand la commande échoue, et il dit ce qu'il a lu avant de dire que tout va bien.

Le 5 octobre, un run Jest filtré avec `grep -E "✓|✕|Tests:"` a annoncé « Tests: 8 passed » pour deux fichiers, dont l'un n'avait pas tourné du tout. Une suite qui ne se charge pas n'a aucun test, ni vert ni rouge : son échec se lit `● Test suite failed to run`, et `Tests:` ne compte que ce qui a tourné. Le seul endroit où cela se voit est `Test Suites: 1 failed, 1 passed`. Je garde `Test Suites:` dans le filtre et je le lis en premier.

## Une garde qui couvre un seul de ses deux chemins

Une dernière forme de faux vert survit aux tests. Le 15 août 2026, trois défauts sur une même application avaient la même forme : la règle était correcte, documentée et testée, sur le chemin qu'elle couvrait. Un helper `clampToDecimals` protégeait la construction des ordres contre l'exception de `parseUnits` ; le chemin de cotation appelait `parseUnits` brut, et l'écran affichait `fractional component exceeds decimals`, puis accusait le fournisseur de n'avoir aucune route. Une reconstruction du prix brut était branchée à l'achat et pas à la vente. Une ligne de statut s'ouvrait encore par `if (venue !== 'uniswap') return null`. Le défaut vit entre les appelants, pas dans la règle, donc relire la garde ne le trouve jamais. Un grep sur la fonction appelée en dessous, `parseUnits`, trouve les trous ; un grep sur la garde ne trouve que les endroits déjà protégés.

## Ce que je retiens

- Un rouge contre un module manquant n'est pas un rouge. Un rouge contre un stub qui répond des constantes en est un, et le décompte doit être complet.
- Une assertion qui reste verte contre le stub est à surveiller : couverte par une autre, ou décorative.
- Quand la garde est venue en premier, la désactiver et regarder le test tomber, puis restaurer depuis une sauvegarde au niveau de l'octet et `cmp`.
- Le silence n'est pas un succès. Lire le code de sortie, lire `Test Suites:`, et faire dire au contrôle ce qu'il a lu avant qu'il dise OK.
- Une garde à moitié branchée consomme la vigilance qu'une garde absente ne consommerait pas. Faire le grep sur l'appelé, pas sur la garde.
