---
title: "Un formulaire Elementor sur mesure qui a échoué de quatre façons silencieuses"
description: "Un widget de formulaire multi-étapes calqué sur celui d'Elementor Pro : un 403 sur son script, un zip décompressé à plat, le mauvais ID de post, et un plugin de sécurité qui refuse le visiteur."
pubDate: 2026-10-20
track: "infrastructure"
tags: ["wordpress", "elementor", "forms", "deployment", "email"]
sources: ["wordpress/widget-formulaire-elementor-rendu-dans-un-template.md", "wordpress/deployer-un-plugin-wordpress-depuis-windows.md", "wordpress/wp-cerber-et-un-formulaire-ajax-anonyme.md", "wordpress/demande-plugins-restauration-et-formulaires-elementor.md"]
---

## Le formulaire

Le 20 octobre 2026, le site d'un client avait un formulaire multi-étapes qui ne fonctionnait pas. C'était un widget Elementor sur mesure qui reproduit le widget Form d'Elementor Pro : plusieurs étapes, une soumission en AJAX, un e-mail via `wp_mail()` et une API d'e-mail transactionnel. Le widget vit dans un template réutilisable, inséré dans la page par un shortcode.

Rien sur ce site ne levait jamais d'erreur. Le HTML était complet, PHP ne journalisait rien, le plugin semblait actif dans l'admin. Chacun des quatre défauts ci-dessous était invisible depuis l'endroit où j'ai d'abord regardé.

## 1. PHP fonctionne, le script renvoie 403

Symptôme : toutes les étapes du formulaire s'empilaient sur la page, et il était impossible de l'envoyer. Une seule ligne dans la console du navigateur : « Failed to load resource: 403 ».

Les dossiers du plugin étaient en `drwx------`. Sur cet hébergement, PHP tourne sous le propriétaire du compte, donc il lisait les classes et affichait le widget. nginx sert les fichiers statiques sous un autre utilisateur, et a refusé le script du widget dans `assets/js/`. Le script qui regroupe les étapes ne s'exécutait jamais.

Le diagnostic a pris deux commandes : `curl -o /dev/null -w '%{http_code}'` sur l'URL du script, puis `stat -c '%A %n'` en descendant l'arborescence. Pour prouver la cause avant de toucher au serveur, j'ai servi le même script à la page en ligne avec `page.route()` de Playwright. Le formulaire a repris vie, donc le code n'était pas en cause. Le correctif est `chmod 755` sur les dossiers et `644` sur les fichiers, et il a sa place dans le script de déploiement, exécuté à chaque déploiement, pas dans une note quelque part.

## 2. Le zip se décompresse à plat

Le zip avait été construit sous Windows avec `[System.IO.Compression.ZipFile]::CreateFromDirectory` dans Windows PowerShell 5.1. Ses entrées sont écrites `includes\class-x.php`, avec une barre oblique inverse. `unzip_file()` de WordPress sous Linux la prend au pied de la lettre : on obtient des fichiers à plat nommés `includes\class-x.php`, et chaque `require_once 'includes/...'` échoue. `Compress-Archive` et `tar` ajoutent un dossier parent, ce qui casse l'installation par upload d'une autre manière.

Je construis plutôt le zip en Python avec `zipfile` : contenu à la racine, séparateurs `/`, permissions Unix explicites dans `external_attr`. Puis je le vérifie comme la production l'utilisera : `unzip_file()` sur le serveur dans `/tmp`, et `diff -r` contre le plugin installé. Lister le zip sous Windows ne prouve rien.

## 3. Les réglages appartiennent au template, pas à la page

Le script chargé, les soumissions n'envoyaient toujours aucun e-mail. Rejouer exactement la charge utile du formulaire renvoyait `success: false`, « settings not found ».

Le formulaire envoyait `post_id = get_the_ID()`, l'ID de la page. Le gestionnaire cherchait le widget dans le `_elementor_data` de la page, où il n'existe pas : il vit dans le template. Elementor Pro publie l'ID du document en cours de rendu, `Plugin::$instance->documents->get_current()->get_main_id()`, qui est celui du template lorsque le widget s'y trouve. Après le correctif, le formulaire envoie l'ID du template.

La relecture des réglages doit elle aussi suivre Elementor Pro, pas le JSON brut :

1. `documents->get( $post_id )->get_elements_data()`, puis une recherche récursive de l'élément par son `id`.
2. Si l'élément est un widget global (`templateID`), lire à la place les éléments de ce template.
3. `create_element_instance( $element )->get_settings_for_display()`. Le `_elementor_data` brut ne stocke que les valeurs que quelqu'un a modifiées ; cet appel ajoute les valeurs par défaut des contrôles et résout les dynamic tags.
4. Ne garder que les champs déclarés dans `form_fields`, et ignorer toute autre clé du POST.

Trois pièges plus petits issus du même widget :

- **Pas de nonce sur un formulaire public.** Une page en cache sert un nonce expiré et le formulaire échoue pour tous les visiteurs. Elementor Pro n'en utilise pas ; un champ honeypot fait le travail.
- **Ne pas publier les réglages.** La première version les déversait dans un attribut `data-settings` du `<form>`, adresse du destinataire et modèle de message compris. Les contrôles marqués `frontend_available` suffisent.
- **Les variables d'e-mail en une seule passe.** `[field id="name"]` et `[all-fields]` sont remplacés en jetons, puis en marqueurs, puis en valeurs, pour qu'un visiteur qui tape `[field id=...]` ne le voie pas interprété.

## 4. Le plugin de sécurité refuse le visiteur, pas l'e-mail

Avant d'activer WP Cerber, la question était « va-t-il casser les e-mails ? ». Il ne le peut pas : `wp_mail()` et l'appel HTTPS sortant vers l'API d'e-mail se font côté serveur, et Cerber inspecte les requêtes entrantes. Ce qu'il peut casser, c'est la soumission qui déclenche l'e-mail.

Son moteur « Protect all forms on the website with bot detection engine » (réglage `botsany`) vérifie un champ caché sur chaque envoi de formulaire. Les utilisateurs connectés et l'action `heartbeat` sont exemptés ; un POST anonyme vers `admin-ajax.php`, qui est exactement ce qu'envoie un formulaire AJAX sur mesure, ne l'est pas. Il reçoit un 403, Activity journalise « Spam form submission denied », et aucun e-mail ne part, alors que le chemin de l'e-mail lui-même est sain.

Six jours plus tard, j'ai mesuré cet échec sur un autre site où le moteur était activé : 63 soumissions refusées entre fin juillet et le 26 octobre, depuis 43 adresses, dont trois tentatives en une heure et demie depuis la même connexion. Quelqu'un qui réessayait. Aucun de ces messages n'a été conservé nulle part.

Donc, avant d'activer un plugin de sécurité, lisez sa configuration stockée avec WP-CLI, pas ses écrans : un plugin inactif peut conserver une configuration complète en base, et c'est elle qui s'applique à la réactivation. Sur le site du formulaire, `botsany` était désactivé, et l'activation a laissé le formulaire intact. Si vous voulez le moteur, son « safe mode » (`botssafe`) fait passer l'AJAX à une vérification par cookie, ou vous excluez `/wp-admin/admin-ajax.php` de l'analyse, ce qui supprime toute inspection de l'AJAX. La protection la plus saine vit dans le widget : un honeypot et un rate limit qui connaissent leurs propres requêtes.

## Un mot sur le marché

Par curiosité, j'ai mesuré la taille que peut atteindre ce type de plugin. Sur WordPress.org, les extensions qui prolongent le formulaire d'Elementor Pro plafonnent à 8 000 à 20 000 installations actives chacune (champs conditionnels, masques de saisie, entrées vers Google Sheets). Le plugin qui stocke les entrées de Contact Form 7 en compte 600 000, parce que Contact Form 7 ne stocke rien ; Elementor Pro conserve déjà ses soumissions. Un widget de formulaire sur mesure comme celui-ci vaut la peine d'être construit pour le besoin exact d'un site. Comme produit, le plafond est bas.

## Ce que je retiens

- Un widget qui dépend de son script échoue sans erreur. Vérifiez le statut HTTP du script avant de lire le moindre PHP.
- Vérifiez un déploiement par le chemin qu'emprunte la production : nginx pour les fichiers statiques, `unzip_file()` pour le zip, la vraie charge utile pour le gestionnaire.
- Dans un template, tout ce qui doit retrouver le widget passe par l'ID du document qui le contient, jamais par `get_the_ID()`.
- Un plugin de sécurité ne « casse » jamais l'e-mail. Demandez ce que chaque réglage fait à un POST anonyme sur `admin-ajax.php`, et lisez la réponse dans la configuration stockée avant d'activer.
