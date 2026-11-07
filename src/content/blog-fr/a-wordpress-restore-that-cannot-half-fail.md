---
title: "Une restauration WordPress qui ne peut pas échouer à moitié"
description: "Réécrire gratuitement la restauration .wpress d'All-in-One WP Migration : ce que l'import officiel perd en silence, et le préfixe temporaire plus le RENAME unique qui gardent le site intact."
pubDate: 2026-10-27
track: "infrastructure"
tags: ["wordpress", "backup", "migration", "mysql", "mariadb", "open-source"]
sources: ["wordpress/format-wpress-et-import-all-in-one-wp-migration.md", "wordpress/restaurer-un-site-wordpress-sans-le-casser-en-route.md", "wordpress/verifier-une-migration-wordpress-depuis-l-exterieur.md", "wordpress/demande-plugins-restauration-et-formulaires-elementor.md"]
---

## Pourquoi écrire un énième plugin de restauration

All-in-One WP Migration est le plugin de migration le plus installé sur WordPress.org : 5 millions de sites actifs, 30 000 à 50 000 téléchargements par jour. Sa version gratuite importe par le navigateur, donc en pratique la limite d'upload de l'hébergeur plafonne la sauvegarde que l'on peut restaurer, et restaurer depuis sa propre liste de sauvegardes est réservé à une extension payante. Le 27 octobre 2026, il me fallait le flux le plus simple possible : déposer le fichier `.wpress` en SFTP, le voir listé, cliquer sur Restaurer. Je n'ai trouvé aucun outil gratuit en qui j'aie confiance pour le faire, alors j'en ai écrit un, et je l'ai publié le jour même sous forme de plugin open source, [WPress Restore](https://github.com/tonystechofficial/wpress-restore).

Je ne suis pas le seul. Une recherche de « wpress » dans le répertoire de plugins renvoie 21 plugins, dont une douzaine ont été publiés entre mai et novembre 2026. Tous se situent entre 0 et 90 installations. Le besoin est réel ; ce qui est rare, c'est une restauration à laquelle on peut se fier. Cet article porte sur cette partie.

## Ce que l'import officiel perd sans le dire

J'ai lu l'import dans le code source du plugin (version 7.112, GPL), puis je l'ai mesuré sur de vraies sauvegardes.

Il réécrit le site en place, table par table, et il ignore les erreurs SQL, sauf quelques-unes qu'il sait réparer. Ce choix est forcé : une fois la moitié des tables remplacée, s'arrêter laisse un site cassé, donc il continue. Deux conséquences, mesurées le même jour.

**MySQL 8 vers MariaDB 10.6 : succès, trois tables en moins.** L'import n'adapte la collation MySQL 8 `utf8mb4_0900_ai_ci` que lorsque le serveur annonce une version inférieure à 8.0. MariaDB 10.6 annonce « 10.6 », donc rien n'est adapté, le `CREATE TABLE` échoue, l'erreur est ignorée, et l'écran affiche « Your site has been imported successfully! ». À partir d'une sauvegarde d'un site sous MySQL 8.0.46, 12 tables sur 15 sont revenues. Les trois tables qu'un plugin avait créées sans collation explicite avaient disparu, avec toutes leurs lignes. Le contre-test : l'import officiel perd les mêmes tables avec sa propre sauvegarde comme avec une sauvegarde faite par un autre outil, donc le défaut est dans l'import, pas dans l'archive. MariaDB 11.4 connaît cette collation et ne perd rien.

**Une sauvegarde WordPress 6.8+ sur un WordPress plus ancien : plus personne ne peut se connecter.** Depuis la 6.8, WordPress stocke les mots de passe en bcrypt (`$wp$2y$…`), que les versions plus anciennes ne savent pas vérifier. Une sauvegarde de WordPress 7.1.3 restaurée sur WordPress 6.1.1 s'importe proprement, thème, plugins et pages publiques en 200, et `wp_check_password()` refuse tous les mots de passe de la sauvegarde. Pas de connexion, donc pas de mise à jour depuis l'admin non plus. Mettez WordPress à jour d'abord, restaurez ensuite.

## L'archive, en bref

Un fichier `.wpress` est une suite de fichiers, chacun précédé d'un en-tête de 4 377 octets : nom, taille stockée, mtime, dossier et, depuis la version 7, un CRC32 du contenu d'origine. Le bloc de fin porte la taille et le CRC32 de tout ce qui précède, que je peux recalculer par morceaux avec le `crc32_combine` de zlib (vérifié sur 20 Mo et 2,3 Go). Le chiffrement découpe le contenu en blocs de 512 000 octets, en AES-256-CBC, avec une clé dérivée du mot de passe. La compression est du zlib par bloc, chaque bloc étant préfixé par sa longueur.

Un détail compte pour quiconque écrit une restauration : dans le dump SQL, `active_plugins` est exporté vide, de même que `template` et `stylesheet`. La vraie liste vit dans `package.json` et s'applique à la fin de l'import. Un outil qui se contente de rejouer `database.sql` vous donne un site sans thème ni plugins.

## Restaurer à côté du site, puis basculer une seule fois

Comme l'import officiel travaille en place, il ne peut pas se permettre de s'arrêter sur une erreur. Le mien importe chaque table sous un préfixe temporaire, `wpr<6 hex>_`, pendant que le site continue de tourner sur ses propres tables. Dans la table d'options temporaire, je renseigne ce que le site doit conserver : son adresse, ses réglages d'upload, son thème et ses plugins actifs tirés de `package.json`, et le plugin de restauration lui-même. Puis tout bascule en une seule instruction :

```sql
RENAME TABLE wp_options TO old_options, wpr1a2b3c_options TO wp_options, ...;
```

MySQL et MariaDB exécutent un `RENAME TABLE` multi-tables de façon atomique. Une table qui ne peut pas être créée arrête la restauration avant la bascule, et le site en ligne n'a pas bougé. La restauration peut donc être stricte sur la moindre erreur SQL, ce que l'import en place ne pourra jamais être.

Deux autres choses l'ont fait tenir sur un hébergement mutualisé ordinaire :

- **Des requêtes courtes et reprenables.** Chaque requête AJAX travaille environ 10 secondes, ou un tiers de `max_execution_time`, puis sauvegarde sa position : offset dans l'archive, offset dans le dump, octets déjà écrits d'un gros fichier. Une vidéo de 2,3 Go est revenue octet pour octet en 21 requêtes. Les uploads se font par morceaux sous la limite de l'hébergeur : 2,3 Go en 1 222 morceaux sous une limite d'upload de 2 Mo. `CREATE` et `DROP` valident implicitement, donc la position doit être sauvegardée juste après, sinon une reprise rejoue des lignes déjà validées.
- **Une garde pour les requêtes de la restauration elle-même.** Pendant l'écriture des fichiers, un plugin actif peut avoir un nouveau fichier principal et d'anciens includes, et lever une erreur fatale à chaque requête, y compris celles de la restauration. Un plugin must-use se charge avant les plugins et le thème (j'ai vérifié l'ordre dans `wp-settings.php`), donc, pour les requêtes de la restauration uniquement, il filtre `option_active_plugins` pour ne garder que l'outil de restauration et fait pointer `template` et `stylesheet` vers un thème qui n'existe pas. Aucun `functions.php` ne se charge. Il se supprime lui-même à la fin.

## Ce que les tests au vert ont manqué

Une fois tous les tests de bout en bout passés, une revue indépendante du code a trouvé 12 défauts. Les pires venaient de variations d'hébergement que ma pile Docker standard n'avait pas. J'ai reproduit chacun avant de le corriger, avec des overlays compose pour l'hébergement concerné.

- **Les serveurs qui ignorent la casse des noms de table** (`lower_case_table_names=1`, la valeur par défaut sous Windows et macOS). `SHOW TABLES` renvoie `wpb_upper_table` là où le dump dit `wpb_Upper_Table`, la recherche sensible à la casse rate la table en ligne, et tout le `RENAME TABLE` échoue. Sur MySQL 8.0.46, la deuxième restauration échouait avec « Table already exists » ; avec des noms comparés en minuscules, elle aboutit.
- **PHP 8 et `disable_functions`.** Une fonction désactivée n'existe plus en PHP 8, et l'appeler est fatal même derrière un `@`. Avec `set_time_limit` et `flock` désactivées, chaque requête renvoyait la page « erreur critique » de WordPress. Tout passe désormais d'abord par `function_exists()`.
- **`upload_tmp_dir` hors de `open_basedir`.** PHP écrit le morceau envoyé, puis `filesize()` et `fopen()` ne peuvent pas le lire. D'abord `move_uploaded_file()`, ensuite on travaille sur la copie.
- **La bascule met fin à la session.** Les utilisateurs et leurs jetons viennent maintenant de la sauvegarde, donc tout ce qui suit le `RENAME` doit tenir dans la même requête et ne doit pas pouvoir échouer.

Un serveur de test rapide ne prouve pas non plus la reprise : les étapes se terminent sous le budget de temps et ne sont jamais coupées. J'ai abaissé le budget par un filtre pour forcer la coupure.

## La preuve sur un vrai site

La première vraie restauration a copié un site client vers un domaine temporaire sur le même hébergeur. Je ne me suis pas fié à l'écran de fin ; j'ai comparé de l'extérieur, en HTTP : sitemaps, `X-WP-Total` par type de contenu, namespaces REST, texte de chaque page après remplacement du domaine, chaque fichier média par SHA-1. 24 pages et 212 fichiers médias, identiques. Ce qui restait n'était pas le site mais ses liens avec l'ancien domaine : une clé reCAPTCHA à étendre au nouveau nom d'hôte, et une copie à tenir à l'écart des moteurs de recherche.

Le plugin crée désormais aussi des sauvegardes, dans le même format, pour que l'outil que le propriétaire du site connaît déjà puisse toujours les restaurer. Les mêmes 448 fichiers, octet pour octet, que l'export officiel du même site, sauf là où l'export officiel perd des données : il renomme les options du cœur qui commencent par `wp_` quand le préfixe change, et MySQL 8 refuse les lignes de ses colonnes générées. Les deux sont mesurés dans le README.

## Ce que je retiens

- Un import qui ne peut pas s'arrêter doit ignorer les erreurs, et un import qui ignore les erreurs annoncera un succès avec des données manquantes. Construisez le résultat à côté de l'existant et basculez une seule fois.
- « Imported successfully » est un message, pas une mesure. Comptez les tables, comparez les pages, hachez les fichiers.
- Attribuez chaque perte par un contre-test : la même sauvegarde passée dans les deux outils vous dit si c'est l'archive ou l'import qui est en cause.
- Les variations d'hébergement cassent plus de restaurations que les chemins de code. Testez exprès les noms de table insensibles à la casse, les fonctions désactivées et un `open_basedir` verrouillé.
- Dans une niche encombrée, le produit n'est pas la chose rare. La preuve, si.
