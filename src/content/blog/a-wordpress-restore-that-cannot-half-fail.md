---
title: "A WordPress restore that cannot half-fail"
description: "Rewriting All-in-One WP Migration's .wpress restore for free: what the official import loses in silence, and the temporary prefix and single RENAME that keep a site intact."
pubDate: 2026-10-27
track: "infrastructure"
tags: ["wordpress", "backup", "migration", "mysql", "mariadb", "open-source"]
sources: ["wordpress/format-wpress-et-import-all-in-one-wp-migration.md", "wordpress/restaurer-un-site-wordpress-sans-le-casser-en-route.md", "wordpress/verifier-une-migration-wordpress-depuis-l-exterieur.md", "wordpress/demande-plugins-restauration-et-formulaires-elementor.md"]
---

## Why write another restore plugin

All-in-One WP Migration is the most installed migration plugin on WordPress.org: 5 million active sites, 30 000 to 50 000 downloads a day. Its free version imports through the browser, so in practice the host's upload limit caps the backup you can restore, and restoring from its own list of backups is reserved for a paid extension. On 27 October 2026 I needed the simplest possible flow: drop the `.wpress` file by SFTP, see it listed, click Restore. I found no free tool I trusted to do it, so I wrote one, and published it the same day as an open-source plugin, [WPress Restore](https://github.com/tonystechofficial/wpress-restore).

I am not the only one. A search for "wpress" in the plugin directory returns 21 plugins, and about a dozen of them were published between May and November 2026. All of them sit between 0 and 90 installs. The need is real; what is rare is a restore you can trust. This post is about that part.

## What the official import loses without saying so

I read the import in the plugin's source (version 7.112, GPL), then measured it on real backups.

It rewrites the site in place, table by table, and it ignores SQL errors, except a few it knows how to repair. That choice is forced: once half the tables are replaced, stopping leaves a broken site, so it carries on. Two consequences, measured the same day.

**MySQL 8 to MariaDB 10.6: success, three tables short.** The import adapts the MySQL 8 collation `utf8mb4_0900_ai_ci` only when the server reports a version below 8.0. MariaDB 10.6 reports "10.6", so nothing is adapted, the `CREATE TABLE` fails, the error is ignored, and the screen says "Your site has been imported successfully!". From one backup of a MySQL 8.0.46 site, 12 tables out of 15 came back. The three tables a plugin had created without an explicit collation were gone, with all their rows. The counter-test: the official import loses the same tables from its own backup and from a backup made by another tool, so the defect is in the import, not in the archive. MariaDB 11.4 knows that collation and loses nothing.

**A WordPress 6.8+ backup on an older WordPress: nobody can log in.** Since 6.8, WordPress stores passwords in bcrypt (`$wp$2y$…`), which older versions cannot check. A WordPress 7.1.3 backup restored on WordPress 6.1.1 imports cleanly, theme and plugins and front pages in 200, and `wp_check_password()` refuses every password from the backup. No login, so no update from the admin either. Update WordPress first, then restore.

## The archive, briefly

A `.wpress` file is a sequence of files, each behind a 4 377-byte header: name, stored size, mtime, folder, and since version 7 a CRC32 of the original content. The end block carries the size and CRC32 of everything before it, which I can recompute by chunks with zlib's `crc32_combine` (checked on 20 MB and 2.3 GB). Encryption cuts the content into 512 000-byte blocks, AES-256-CBC, key derived from the password. Compression is zlib per block, each block prefixed with its length.

One detail matters for anyone writing a restore: in the SQL dump, `active_plugins` is exported empty, and so are `template` and `stylesheet`. The real list lives in `package.json` and is applied at the end of the import. A tool that only replays `database.sql` gives you a site with no theme and no plugins.

## Restore beside the site, then switch once

Because the official import works in place, it cannot afford to stop on an error. Mine imports every table under a temporary prefix, `wpr<6 hex>_`, while the site keeps running on its own tables. In the temporary options table I set what the site must keep: its address, its upload settings, its theme and active plugins taken from `package.json`, and the restore plugin itself. Then everything switches in one statement:

```sql
RENAME TABLE wp_options TO old_options, wpr1a2b3c_options TO wp_options, ...;
```

MySQL and MariaDB run a multi-table `RENAME TABLE` atomically. A table that cannot be created stops the restore before the switch, and the live site has not changed. So the restore can be strict on every SQL error, which the in-place import never can.

Two more things made it hold on ordinary shared hosting:

- **Short, resumable requests.** Each AJAX request works about 10 seconds, or a third of `max_execution_time`, then saves its position: offset in the archive, offset in the dump, bytes already written of a big file. A 2.3 GB video came back byte for byte in 21 requests. Uploads go in chunks under the host's limit: 2.3 GB in 1 222 chunks under a 2 MB upload limit. `CREATE` and `DROP` commit implicitly, so the position has to be saved right after them or a resume replays rows already committed.
- **A guard for the restore's own requests.** While files are being written, an active plugin can have a new main file and old includes, and throw a fatal error on every request, including the restore's. A must-use plugin loads before plugins and the theme (I checked the order in `wp-settings.php`), so for the restore's requests only it filters `option_active_plugins` down to the restore tool and points `template` and `stylesheet` to a theme that does not exist. No `functions.php` loads. It removes itself at the end.

## What the green tests missed

After every end-to-end test passed, an independent review of the code found 12 defects. The worst came from hosting variations my standard Docker stack did not have. I reproduced each one before fixing it, with compose overlays for the host in question.

- **Servers that ignore table-name case** (`lower_case_table_names=1`, the default on Windows and macOS). `SHOW TABLES` returns `wpb_upper_table` where the dump says `wpb_Upper_Table`, the case-sensitive lookup misses the live table, and the whole `RENAME TABLE` fails. On MySQL 8.0.46 the second restore failed with "Table already exists"; with names compared in lower case it completes.
- **PHP 8 and `disable_functions`.** A disabled function no longer exists in PHP 8, and calling it is fatal even behind `@`. With `set_time_limit` and `flock` disabled, every request returned WordPress's "critical error" page. Everything goes through `function_exists()` first.
- **`upload_tmp_dir` outside `open_basedir`.** PHP writes the uploaded chunk, then `filesize()` and `fopen()` cannot read it. `move_uploaded_file()` first, then work on the copy.
- **The switch ends the session.** Users and their tokens now come from the backup, so everything after the `RENAME` has to fit in the same request and must not be able to fail.

A fast test server does not prove resumption either: the steps finish under the time budget and never split. I lowered the budget through a filter to force it.

## Proving it on a real site

The first real restore copied a client site to a temporary domain on the same host. I did not trust the end screen; I compared from outside, over HTTP: sitemaps, `X-WP-Total` per post type, REST namespaces, the text of every page after replacing the domain, every media file by SHA-1. 24 pages and 212 media files, identical. What was left was not the site but its ties to the old domain: a reCAPTCHA key to extend to the new hostname, and a copy to keep out of search engines.

The plugin now also creates backups, in the same format, so the tool the site owner already knows can still restore them. Same 448 files, byte for byte, as the official export of the same site, except where the official export loses data: it renames core options that start with `wp_` when the prefix changes, and MySQL 8 refuses the rows of its generated columns. Both are measured in the README.

## What I keep

- An import that cannot stop must ignore errors, and an import that ignores errors will report success with data missing. Build the result beside the live one and switch once.
- "Imported successfully" is a message, not a measurement. Count the tables, compare the pages, hash the files.
- Attribute every loss with a counter-test: the same backup through both tools tells you whether the archive or the import is at fault.
- Hosting variations break more restores than code paths do. Test case-insensitive table names, disabled functions and a locked `open_basedir` on purpose.
- In a crowded niche, the product is not the scarce part. Proof is.
