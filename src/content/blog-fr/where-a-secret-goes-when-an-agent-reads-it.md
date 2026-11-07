---
title: "Où va un secret quand un agent de code le lit"
description: "Une phrase de récupération traînait en clair dans plus de 70 fichiers d'un serveur, copiée par des éditeurs et des assistants IA qui l'avaient lue. Seule la rotation nettoie."
pubDate: 2026-09-28
track: "ai-engineering"
tags: ["security", "claude-code", "secrets", "observability"]
sources: ["securite/enqueter-sur-une-phrase-de-recuperation-sans-jamais-la-lire.md", "claude-code/ou-atterrit-un-secret-colle-dans-une-conversation.md", "claude-code/utiliser-un-secret-sans-lexposer-a-lagent.md", "securite/secret-en-ligne-de-commande-proc-lisible.md", "securite/une-url-de-fournisseur-rpc-porte-sa-cle-un-journal-qui-l-ecrit-la-publie.md", "node/ethers-l-erreur-porte-l-url-de-la-requete-et-sa-cle.md", "securite/livrer-un-document-a-secrets-sans-que-l-assistant-les-lise.md", "observability/05-otel-security.md"]
---

## Un wallet qui a signé ce que le nœud n'a jamais demandé

Le 28 septembre 2026, le wallet d'un nœud blockchain sur la plateforme d'un client avait signé trois transactions que le nœud n'avait jamais faites. Une seule explication tient : une seconde instance, restaurée depuis la même phrase de récupération de 24 mots, existait quelque part. Je devais trouver comment la phrase avait pu quitter le serveur, et l'agent qui faisait le travail, Claude Code, avait une contrainte dès le départ : ne jamais afficher la phrase, ne jamais l'écrire, ne jamais la faire voyager.

Le scanner tourne donc là où vit la phrase, la lit en mémoire et ne renvoie que des empreintes : le SHA-256 de chaque fenêtre de huit mots consécutifs, 17 fenêtres pour 24 mots. Huit mots d'une liste de 2 048 font 88 bits, ce qui ne s'inverse pas ; trois ou quatre mots tombent en force brute en quelques minutes, donc je ne descends jamais sous huit. Sur toutes les autres machines, le script hache chaque suite de huit mots dans chaque fichier texte et compare. La sortie, ce sont des chemins de fichiers et des dates, jamais du texte. J'ai d'abord contrôlé l'instrument sur une phrase connue, et ça a compté : le premier run a annoncé « aucune occurrence » après la lecture d'un seul fichier, et seul le compteur « files read: 1 » l'a trahi.

Le poste de travail (5 081 fichiers, 327 Mo) et le serveur de test (14 552 fichiers, 1,7 Go) étaient propres. Le serveur du nœud ne l'était pas. Sur 73 890 fichiers texte, la phrase était en clair dans plus de 70 fichiers hors de sa configuration : l'historique local d'un éditeur distant, 41 fichiers de points de contrôle pris par une extension IA de cet éditeur, la session d'un assistant IA en ligne de commande, quatre lignes d'historique shell où le nœud avait été lancé à la main avec la phrase en argument, les transcripts d'un autre assistant IA sur cinq sessions entre le 19 juillet et le 7 août 2026, et des instantanés version par version d'un fichier de configuration que cet assistant avait édité.

Personne n'avait collé la phrase dans une conversation. Elle y était arrivée parce qu'un assistant avait lu un fichier, ou la sortie d'une commande, qui la contenait. Chaque lecture l'envoyait au service qui héberge le modèle et l'écrivait sur disque une fois de plus.

## Où atterrit un secret lu

Le réflexe « je colle la clé une fois, l'agent n'en a besoin qu'une fois » suppose que la conversation est un canal. C'est un journal, dupliqué par construction. Sur un poste de travail ordinaire, environ 1 400 fichiers de transcript et 310 Mo, un identifiant unique apparaissait 44 fois dans 6 fichiers. Les réservoirs :

- Les transcripts locaux, écrits en JSON Lines sous `~/.claude/projects/<slug>/`.
- Les transcripts des sous-agents. Un des six fichiers appartenait à un agent lancé dans un workflow, dans un répertoire que personne n'ouvre. Un sous-agent hérite du contexte, donc le secret voyage dans des fichiers où il n'a jamais été tapé.
- La télémétrie, quand la journalisation du contenu est activée : prompts, réponses et contenus d'outils partent vers le collecteur, indexés, interrogeables et conservés pendant sa rétention. Le corps d'une ligne de log ne contient que le nom de l'événement ; la charge utile est dans les labels, dont l'un porte la ligne de commande complète. Chercher dans le corps renvoie zéro et ne prouve rien.
- La retransmission et les résumés de compactage. Tout le contexte repart vers le modèle à chaque tour, et quand la conversation est résumée, le secret peut être recopié dans le nouveau contexte, et survivre au message qu'on croyait avoir supprimé.

Les durées de vie diffèrent : 14 jours de rétention des logs, des transcripts locaux qui restent, un résumé qui voyage pendant toute une session. Le maillon le plus long compte. Un secret vu une fois est un secret à révoquer ; le seul vrai nettoyage est la rotation.

## Le critère, c'est stdout

Le point de bascule n'est pas « le secret est dans un fichier ». C'est « le secret sort-il sur stdout ? ». Les outils shell renvoient leur sortie à l'agent, donc une commande qui utilise la valeur est sûre et une commande qui l'affiche est une fuite :

```bash
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/v1/me   # safe
echo $TOKEN                                                            # leak
```

L'expansion se fait dans le shell ; le transcript enregistre `$TOKEN`, pas sa valeur. De là, trois niveaux d'indirection, du plus sûr au moins sûr.

Déléguer. Une CLI authentifiée signe ses propres requêtes et l'agent ne manipule jamais l'identifiant : `gh pr create --fill`, `vercel env add STRIPE_KEY`, `stripe trigger payment_intent.succeeded`.

Référencer. Charger la valeur dans l'environnement sans l'afficher. En PowerShell, une affectation ne produit aucune sortie :

```powershell
$env:API_KEY = (Get-Content .\keyfile -Raw).Trim()
Invoke-RestMethod -Uri $url -Headers @{ "api-key" = $env:API_KEY }
```

Interdire. Une règle `deny` bloque aussi la lecture accidentelle, celle que personne n'a demandée :

```json
{
  "permissions": {
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./config)",
      "Read(./**/*.key)"
    ]
  }
}
```

Un piège en chemin : le bloc `env:` de `settings.json` est un stockage en clair, non chiffré, parfois versionné, dupliqué par un `settings.json.bak` à côté. Une valeur qui s'y trouve est aussi exposée que dans un `.env`. Et je ne demande pas à l'agent « de ne pas regarder ». Ce qui doit rester invisible doit être illisible.

## /proc ne ment pas

Ces quatre lignes d'historique shell étaient à elles seules une seconde fuite. Un secret passé en argument de ligne de commande se trouve dans `/proc/<pid>/cmdline`, lisible par tous par défaut. `ls -l /proc/<pid>/cmdline` affiche `-r--r--r--`, et la preuve est `sudo -u <other> cat /proc/<pid>/cmdline` : sur un vrai serveur, en août, cela a renvoyé la graine. La correction évidente, un `EnvironmentFile` systemd en `0600 root` référencé en `${VAR}` dans `ExecStart`, ne change rien, car systemd développe la variable dans `argv` avant d'exécuter. La correction ne marche que si l'application lit elle-même la variable, ce qui veut dire retirer l'argument. Avant de le retirer, comparer les deux valeurs par hash, jamais en les affichant, et après le redémarrage vérifier l'identité du nœud, pas le code de sortie de `systemctl`.

## Une URL qui porte sa clé

Trois jours après l'enquête, sur un backend DeFi en staging, un autre secret a pris la même route. Chez Alchemy et la plupart des fournisseurs RPC, la clé d'API est un segment de l'URL, `/v2/<key>`. Le code ne journalisait jamais l'URL, seulement son hôte. Mais quand ethers v6 échoue, son message d'erreur recopie l'objet `info`, `requestUrl` compris, et le code affichait `e.message` après l'hôte, dans 86 appels de journalisation. Une ligne WARN relue pour un autre problème a montré une partie de la clé. Cinq jours plus tard, un message de niveau trace qui écrivait `rpc=<url>` sans masque a rencontré un `docker logs … | grep … | cut -c1-200` que j'avais lancé pour compter des erreurs, et les neuf premiers caractères de la clé ont atterri dans ma conversation avec l'agent.

Le remède vit dans le service de journalisation unique par lequel passe chaque ligne : masquer les valeurs des variables d'environnement secrètes (noms contenant KEY, SECRET, TOKEN, PASSWORD, SEED, MNEMONIC, PRIVATE), puis les formes de clés dans les URL. Dans le shell, masquer avant tout filtre :

```bash
sed -E 's#(/v2/|/v3/|apikey=|key=|token=)[A-Za-z0-9_-]+#\1***#g'
```

Et vérifier une fuite par `grep -c` ou par empreinte. Afficher la ligne pour la vérifier, c'est ainsi que le fragment a atteint mon transcript.

## Livrer un document plein de secrets

La demande légitime existe toujours : « donne-moi la fiche de test, avec les mots de passe ». L'agent n'a pas besoin des valeurs. Il écrit un modèle avec des marqueurs, `{{PW1}}`, `{{EXPERT1_KEY}}`, et un petit générateur. Le générateur tourne sur la machine qui détient les secrets, lit les valeurs réelles là où elles vivent (`docker inspect` pour le `Config.Env` d'un conteneur), vérifie chaque valeur par une propriété publique (une clé privée doit redonner l'adresse attendue, `new ethers.Wallet(key).address`), écrit le fichier en `0600` et n'affiche que des comptes : 15 valeurs remplies, 0 restante, adresses vérifiées. Le fichier est copié par `scp`, et je le vérifie sans le lire : sa taille, et `grep -c '{{'` égal à 0.

Une recherche dans le fichier rempli est un aperçu. Le lendemain, un grep visant des lignes de tableau a aussi attrapé la ligne d'accès d'un poste, et son mot de passe a atterri dans la conversation. Il a fallu le changer.

## Ce que je retiens

- Un secret que l'agent a lu n'est plus confidentiel. Le faire tourner ; supprimer la conversation n'atteint aucune des copies.
- Le critère est « la valeur sort-elle sur stdout ? ». Donner à l'agent une référence, jamais la valeur.
- Déléguer d'abord à une CLI authentifiée, charger l'environnement sans écho ensuite, interdire la lecture des fichiers sensibles en troisième.
- Un argument de ligne de commande est public pour tous les comptes de la machine, et un EnvironmentFile ne le protège pas.
- Vérifier par un compte, un hash ou un booléen. Afficher une ligne pour vérifier une fuite, c'est la fuite.
