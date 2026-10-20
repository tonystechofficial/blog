---
title: "Where a secret goes when a coding agent reads it"
description: "A recovery phrase sat in clear in more than 70 files on one server, copied there by editors and AI assistants that had read it. The only cleanup is rotation."
pubDate: 2026-09-28
track: "ai-engineering"
tags: ["security", "claude-code", "secrets", "observability"]
sources: ["securite/enqueter-sur-une-phrase-de-recuperation-sans-jamais-la-lire.md", "claude-code/ou-atterrit-un-secret-colle-dans-une-conversation.md", "claude-code/utiliser-un-secret-sans-lexposer-a-lagent.md", "securite/secret-en-ligne-de-commande-proc-lisible.md", "securite/une-url-de-fournisseur-rpc-porte-sa-cle-un-journal-qui-l-ecrit-la-publie.md", "node/ethers-l-erreur-porte-l-url-de-la-requete-et-sa-cle.md", "securite/livrer-un-document-a-secrets-sans-que-l-assistant-les-lise.md", "observability/05-otel-security.md"]
---

## A wallet that signed what the node never asked

On September 28, 2026, the wallet of a blockchain node on a client's platform had signed three transactions the node never made. One explanation fits: a second instance, restored from the same 24-word recovery phrase, existed somewhere. I had to find how the phrase could have left the server, and the agent doing the work, Claude Code, had one constraint from the start: never display the phrase, never write it, never make it travel.

So the scanner runs where the phrase lives, reads it in memory and returns only fingerprints: the SHA-256 of each window of eight consecutive words, 17 windows for 24 words. Eight words from a list of 2 048 make 88 bits, which cannot be reversed; three or four words fall to brute force in minutes, so I never go below eight. On every other machine the script hashes every run of eight words in each text file and compares. The output is file paths and dates, never text. I controlled the instrument on a known phrase first, and it mattered: the first run announced "no occurrence" after reading a single file, and only the counter "files read: 1" gave it away.

The workstation (5 081 files, 327 MB) and the test server (14 552 files, 1.7 GB) were clean. The node's own server was not. Out of 73 890 text files, the phrase was in clear in more than 70 files outside its configuration: the local history of a remote editor, 41 checkpoint files taken by an AI extension in that editor, the session of a command-line AI assistant, four lines of shell history where the node had been launched by hand with the phrase as an argument, the transcripts of another AI assistant across five sessions between July 19 and August 7, 2026, and version-by-version snapshots of a configuration file that assistant had edited.

Nobody had pasted the phrase into a conversation. It got there because an assistant read a file, or the output of a command, that contained it. Each read sent it to the service hosting the model and wrote it to disk one more time.

## Where a read secret lands

The reflex "I paste the key once, the agent needs it once" assumes the conversation is a channel. It is a journal, duplicated by construction. On an ordinary workstation, about 1 400 transcript files and 310 MB, one unique identifier appeared 44 times in 6 files. The reservoirs:

- The local transcripts, written as JSON Lines under `~/.claude/projects/<slug>/`.
- The sub-agent transcripts. One of the six files belonged to an agent launched inside a workflow, in a directory nobody opens. A sub-agent inherits context, so the secret travels into files where it was never typed.
- The telemetry, when content logging is on: prompts, responses and tool contents leave for the collector, indexed, searchable and kept for its retention. The body of a log line only holds the event name; the payload is in the labels, one of which carries the full command line. Searching the body returns zero and proves nothing.
- The retransmission and the compaction summaries. The whole context goes back to the model every turn, and when the conversation is summarized the secret can be copied into the new context, outliving the message you thought you had deleted.

Lifetimes differ: 14 days of log retention, local transcripts that stay, a summary that travels for a whole session. The longest link counts. A secret seen once is a secret to revoke; the only real cleanup is rotation.

## The criterion is stdout

The tipping point is not "the secret is in a file". It is "does the secret go out on stdout?". Shell tools return their output to the agent, so a command that uses the value is safe and a command that prints it is a leak:

```bash
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/v1/me   # safe
echo $TOKEN                                                            # leak
```

The expansion happens in the shell; the transcript records `$TOKEN`, not its value. From there, three levels of indirection, safest first.

Delegate. An authenticated CLI signs its own requests and the agent never handles the credential: `gh pr create --fill`, `vercel env add STRIPE_KEY`, `stripe trigger payment_intent.succeeded`.

Reference. Load the value into the environment without echoing it. In PowerShell an assignment produces no output:

```powershell
$env:API_KEY = (Get-Content .\keyfile -Raw).Trim()
Invoke-RestMethod -Uri $url -Headers @{ "api-key" = $env:API_KEY }
```

Forbid. A `deny` rule also blocks the accidental read, the one nobody asked for:

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

One trap on the way: the `env:` block of `settings.json` is clear-text storage, not encrypted, sometimes versioned, duplicated by a `settings.json.bak` next to it. A value there is as exposed as in a `.env`. And I do not ask the agent "not to look". What must stay invisible has to be unreadable.

## /proc does not lie

Those four lines of shell history were a second leak on their own. A secret passed as a command-line argument sits in `/proc/<pid>/cmdline`, world-readable by default. `ls -l /proc/<pid>/cmdline` shows `-r--r--r--`, and the proof is `sudo -u <other> cat /proc/<pid>/cmdline`: on a real server, in August, it returned the seed. The obvious fix, a systemd `EnvironmentFile` in `0600 root` referenced as `${VAR}` in `ExecStart`, changes nothing, because systemd expands the variable into `argv` before executing. The fix only works if the application reads the variable itself, which means removing the argument. Before removing it, compare the two values by hash, never by displaying them, and after the restart check the node's identity, not the exit code of `systemctl`.

## A URL that carries its key

Three days after the investigation, on a DeFi backend in staging, a different secret took the same road. At Alchemy and most RPC providers the API key is a segment of the URL, `/v2/<key>`. The code never logged the URL, only its host. But when ethers v6 fails, its error message copies the `info` object, `requestUrl` included, and the code printed `e.message` after the host, in 86 logging calls. A WARN line reread for another issue showed part of the key. Five days later a trace-level message that wrote `rpc=<url>` unmasked met a `docker logs … | grep … | cut -c1-200` I ran to count errors, and the first nine characters of the key landed in my conversation with the agent.

The remedy lives at the single logging service every line goes through: mask the values of secret environment variables (names containing KEY, SECRET, TOKEN, PASSWORD, SEED, MNEMONIC, PRIVATE), then the key shapes in URLs. In the shell, mask before any filter:

```bash
sed -E 's#(/v2/|/v3/|apikey=|key=|token=)[A-Za-z0-9_-]+#\1***#g'
```

And verify a leak by `grep -c` or by fingerprint. Printing the line to check it is how the fragment reached my transcript.

## Delivering a document full of secrets

The legitimate request still exists: "give me the test sheet, with the passwords". The agent does not need the values. It writes a template with markers, `{{PW1}}`, `{{EXPERT1_KEY}}`, and a small generator. The generator runs on the machine that holds the secrets, reads the live values where they live (`docker inspect` for a container's `Config.Env`), checks each value by a public property (a private key must give back the expected address, `new ethers.Wallet(key).address`), writes the file in `0600` and prints only counts: 15 values filled, 0 remaining, addresses verified. The file is copied by `scp`, and I check it without reading it: its size, and `grep -c '{{'` equal to 0.

A search inside the filled file is a preview. The next day, a grep aimed at table rows also caught the access line of one seat, and its password landed in the conversation. It had to be changed.

## What I keep

- A secret the agent has read is not confidential anymore. Rotate it; deleting the conversation reaches none of the copies.
- The criterion is "does the value leave on stdout?". Give the agent a reference, never the value.
- Delegate to an authenticated CLI first, load the environment without echo second, deny reads on sensitive files third.
- A command-line argument is public to every account on the machine, and an EnvironmentFile does not protect it.
- Verify by count, by hash or by boolean. Printing a line to check a leak is the leak.
