---
title: "A custom Elementor form that failed in four silent ways"
description: "A multi-step form widget built to mirror Elementor Pro's: a 403 on its script, a zip unpacked flat, the wrong post ID, and a security plugin that refused the visitor."
pubDate: 2026-10-20
track: "infrastructure"
tags: ["wordpress", "elementor", "forms", "deployment", "email"]
sources: ["wordpress/widget-formulaire-elementor-rendu-dans-un-template.md", "wordpress/deployer-un-plugin-wordpress-depuis-windows.md", "wordpress/wp-cerber-et-un-formulaire-ajax-anonyme.md", "wordpress/demande-plugins-restauration-et-formulaires-elementor.md"]
---

## The form

On 20 October 2026 a client's site had a multi-step form that did not work. It was a custom Elementor widget that mirrors Elementor Pro's Form widget: several steps, an AJAX submission, an email through `wp_mail()` and a transactional email API. The widget lives in a reusable template, inserted into the page by a shortcode.

Nothing on that site ever raised an error. The HTML was complete, PHP logged nothing, the plugin looked active in the admin. Each of the four defects below was invisible from where I first looked.

## 1. PHP works, the script returns 403

Symptom: every step of the form stacked on the page, and it could not be sent. One line in the browser console: "Failed to load resource: 403".

The plugin's folders were `drwx------`. On that host PHP runs as the account owner, so it read the classes and rendered the widget. nginx serves static files as another user, and refused the widget's script under `assets/js/`. The script that groups the steps never ran.

Diagnosis took two commands: `curl -o /dev/null -w '%{http_code}'` on the script's URL, then `stat -c '%A %n'` down the tree. To prove the cause before touching the server, I served the same script to the live page with Playwright's `page.route()`. The form came back to life, so the code was not at fault. The fix is `chmod 755` on folders and `644` on files, and it belongs in the deploy script, run on every deploy, not in a note somewhere.

## 2. The zip unpacks flat

The zip had been built on Windows with `[System.IO.Compression.ZipFile]::CreateFromDirectory` under Windows PowerShell 5.1. Its entries are written `includes\class-x.php`, with a backslash. WordPress's `unzip_file()` on Linux takes that literally: you get flat files named `includes\class-x.php`, and every `require_once 'includes/...'` fails. `Compress-Archive` and `tar` add a parent folder, which breaks the upload install in a different way.

I build the zip in Python with `zipfile` instead: content at the root, `/` separators, explicit Unix permissions in `external_attr`. Then I check it the way production will use it: `unzip_file()` on the server into `/tmp`, and `diff -r` against the installed plugin. Listing the zip on Windows proves nothing.

## 3. The settings belong to the template, not the page

With the script loaded, submissions still sent no email. Replaying the exact payload of the form returned `success: false`, "settings not found".

The form posted `post_id = get_the_ID()`, the ID of the page. The handler looked for the widget in the page's `_elementor_data`, where it does not exist: it lives in the template. Elementor Pro publishes the ID of the document being rendered, `Plugin::$instance->documents->get_current()->get_main_id()`, which is the template when the widget is inside one. After the fix the form posts the template's ID.

Reading the settings back also has to follow Elementor Pro, not the raw JSON:

1. `documents->get( $post_id )->get_elements_data()`, then a recursive search for the element by its `id`.
2. If the element is a global widget (`templateID`), read that template's elements instead.
3. `create_element_instance( $element )->get_settings_for_display()`. The raw `_elementor_data` stores only the values someone changed; this call adds the control defaults and resolves dynamic tags.
4. Keep only the fields declared in `form_fields`, and ignore any other POST key.

Three smaller traps from the same widget:

- **No nonce on a public form.** A cached page serves an expired nonce and the form fails for every visitor. Elementor Pro does not use one; a honeypot field does the job.
- **Do not publish the settings.** The first version dumped them into a `data-settings` attribute on the `<form>`, recipient address and message template included. Controls marked `frontend_available` are enough.
- **Email variables in one pass.** `[field id="name"]` and `[all-fields]` are replaced tokens, then markers, then values, so a visitor who types `[field id=...]` does not get it interpreted.

## 4. The security plugin refuses the visitor, not the email

Before activating WP Cerber, the question was "will it break the emails?". It cannot: `wp_mail()` and the outbound HTTPS call to the email API happen on the server, and Cerber inspects incoming requests. What it can break is the submission that triggers the email.

Its engine "Protect all forms on the website with bot detection engine" (setting `botsany`) checks a hidden field on every form post. Logged-in users and the `heartbeat` action are exempt; an anonymous POST to `admin-ajax.php`, which is exactly what a custom AJAX form sends, is not. It gets a 403, Activity logs "Spam form submission denied", and no email goes out, while the email path itself is fine.

Six days later I measured that failure on another site where the engine was on: 63 submissions refused between late July and 26 October, from 43 addresses, including three attempts in an hour and a half from the same connection. Someone trying again. None of those messages was kept anywhere.

So before activating a security plugin, read its stored configuration with WP-CLI, not its screens: an inactive plugin can keep a full configuration in the database, and that is what applies on reactivation. On the form's site `botsany` was off, and activation left the form intact. If you want the engine, its "safe mode" (`botssafe`) switches AJAX to a cookie check, or you exclude `/wp-admin/admin-ajax.php` from scanning, which removes all inspection of AJAX. The sounder protection lives in the widget: a honeypot and a rate limit that know their own requests.

## A note on the market

Out of curiosity I measured how big this kind of plugin can get. On WordPress.org, the add-ons that extend Elementor Pro's form top out at 8 000 to 20 000 active installs each (conditional fields, input masks, entries to Google Sheets). The plugin that stores Contact Form 7 entries has 600 000, because Contact Form 7 stores nothing; Elementor Pro already keeps its submissions. A custom form widget like this one is worth building for one site's exact need. As a product, the ceiling is low.

## What I keep

- A widget that depends on its script fails without an error. Check the script's HTTP status before reading any PHP.
- Verify a deploy through the path production uses: nginx for static files, `unzip_file()` for the zip, the real payload for the handler.
- Inside a template, everything that must find the widget again goes through the ID of the document that contains it, never `get_the_ID()`.
- A security plugin never "breaks email". Ask what each setting does to an anonymous POST on `admin-ajax.php`, and read the answer in the stored configuration before activating.
