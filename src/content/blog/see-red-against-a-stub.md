---
title: "See red against a stub, not against a missing module"
description: "A test written before the code first fails on a missing import with zero tests run. The red that proves something is 13 failures out of 13 against a stub."
pubDate: 2026-08-24
track: "ai-engineering"
tags: ["testing", "claude-code", "tdd", "verification"]
sources: ["apprentissage/voir-le-rouge-contre-un-stub.md", "apprentissage/voir-le-rouge-apres-coup-en-desactivant-la-garde.md", "apprentissage/un-negatif-nest-pas-une-reponse.md", "defi/une-sortie-vide-n-est-pas-un-succes.md", "node/execsync-sous-windows-un-controle-qui-ne-lit-rien-repond-ok.md", "node/jest-une-suite-qui-n-a-pas-tourne-ne-se-voit-pas-dans-un-grep.md", "apprentissage/un-garde-qui-ne-couvre-quun-chemin.md"]
---

## The red that proves nothing

The standing rule I give my coding agent is short. When the code is domain logic, a function that decides something from its inputs with no database, network or interface, write the failing test first, run it to see it fail, then write the code that makes it pass. Seeing red is not a formality: a test never seen failing can pass for a reason unrelated to what it is supposed to verify, and a control I believe alive is more dangerous than one I know is missing. Outside domain logic I do not enforce it. On an observed defect the test reproduces the defect before the fix, and the before and after measurements go in the commit message.

When an agent writes the code, this rule has a weak spot I only saw by watching it work. The agent writes the test, runs it, reports red, writes the code, reports green. But the first red is almost always this one:

```
Cannot find module './backupStaleness' from 'backupStaleness.test.js'
Tests: 0 total
```

Zero tests ran. The file was never loaded, so not one assertion was evaluated. This red says one thing, "the module does not exist", which I already knew. It says nothing about what matters: do my assertions discriminate anything at all? The green that follows is a green I have never seen red, exactly the gap the rule was written to close.

## The red that counts

On August 24, 2026 I changed the sequence. Before the test runs for the first time, the agent writes a stub that compiles and decides nothing: the expected return shape, with constant values.

```js
export function backupVerdict() {
  return { status: 'ok', reason: null, drift: 0, remaining: 0 };
}
```

Then the test runs against it, and this time the assertions execute. The count is readable:

```
Tests: 13 failed, 13 total
```

Thirteen out of thirteen. Every assertion sees a difference between a constant answer and the expected one; none passes by accident. That measurement is what authorizes writing the code, and once green, what authorizes believing the green.

The count also talks when it is not complete. On a second module the stub gave `2 failed, 1 passed`. The green assertion was:

```js
expect(encodeSnapshot(releve)).not.toMatch(/[&=]/);
```

The stub returned `"stub"`, which contains neither `&` nor `=`. The assertion passes on an empty implementation, so alone it proves nothing. Not necessarily a defect, a neighbouring round-trip test carries the load here, but I need to know it, and only the count against the stub shows it. An assertion that stays green against the stub is either covered by another one or decorative.

## Why a green needs a control

Underneath is an asymmetry I now apply everywhere. A positive validates itself: if the tool finds the thing, the thing exists. A negative proves nothing until the instrument is proven. "Nothing found" covers two states, the thing does not exist, or I did not look in the right place or the right way. "The test passes" is a negative in disguise: it asserts the absence of a defect, and it is only worth something if the test can fail.

Two readings from one day, August 11, 2026: "10 test suites failed, 0 tests" was the wrong test runner, the project had its own; "`ethers.Interface is not a constructor`" was a repository on ethers v5 with the v6 API written from memory. Neither was a defect in the code. Each time the canonical source, `package.json`, the type, the function body, was one step away, and an accessible approximation won.

## Seeing red after the fact

Sometimes the guard exists before its test. The test written afterwards passes on the first run and nothing says it verifies anything. I do not rewrite the test. I disable the guard.

1. Back up the production file at the byte level, absolute path, computed once.
2. Neutralize only the targeted guard: `if (guard)` becomes `if (false && guard)`, a filter removed, an index made non-unique. Count the modified occurrence to confirm the mutation took.
3. Run only that test. It must fail, with the expected message.
4. Restore from the backup, never by re-editing, then `cmp` file and backup.
5. Run again: green.

Measured on September 30, 2026 on five guards of a payment circuit (a veto filter against a real MongoDB, a unique index, an unknown-issue branch, a reservation resume, an unconfirmed click): each turned its test red once neutralized, the unique index twice in two tries. Re-editing to restore can leave an invisible gap, a line ending or a space, hence the backup and the `cmp`.

## A silent check is not a passing check

The same asymmetry bites outside tests, three times in two weeks.

On September 23, 2026 the agent validated a type change with `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "error TS" | head -8`, followed by an echo announcing that empty meant a clean build. Nothing printed; verdict, clean. False. Without the filter the output was `npm error code EOVERRIDE`: npx had stopped on a dependency conflict before ever invoking tsc. The local binary, `./node_modules/.bin/tsc --noEmit`, exited 0 and meant it. A filter turns every upstream failure into silence. So I read the exit code (`cmd; echo "exit=$?"`), prefer the local binary to a launcher, and require a positive proof, a count or a line that says N tests passed.

On September 28, a pre-commit check on two dApps had been answering "OK, no i18n catalogue detected" for four days. It found its files with `execSync('grep -rl … 2>/dev/null || true')`, written and checked on Linux; on the 24th the work had moved to Windows. `execSync` with a string opens the platform's default shell, cmd.exe on Windows. cmd.exe does not know `/dev/null`, the command failed before grep returned anything, `|| true` erased the failure, and the script read "no files", printed OK and exited 0. Replaced by a tree walk in Node, the same check read 2 catalogues and verified 106 keys on one dApp, 9 files and 86 keys on the other. No raw placeholder had shipped in those four days, which I know after the fact, not by guarantee. A verification script does not call a shell; if it must, it fails when the command fails, and it says what it read before saying all is well.

On October 5, a Jest run filtered with `grep -E "✓|✕|Tests:"` reported "Tests: 8 passed" for two files, one of which had not run at all. A suite that fails to load has no test, green or red: its failure reads `● Test suite failed to run`, and `Tests:` only counts what ran. The only place it shows is `Test Suites: 1 failed, 1 passed`. I keep `Test Suites:` in the filter and read it first.

## A guard that covers one of its two paths

One more shape of false green survives tests. On August 15, 2026, three defects on one application had the same form: the rule was correct, documented, and tested, on the path it covered. A `clampToDecimals` helper protected order construction from `parseUnits` throwing; the quote path called `parseUnits` raw, and the screen said `fractional component exceeds decimals`, then blamed the provider for having no route. A gross-price reconstruction was wired on buy and not on sell. A status line still opened with `if (venue !== 'uniswap') return null`. The defect lives between the callers, not in the rule, so rereading the guard never finds it. A grep on the function called underneath, `parseUnits`, finds the holes; a grep on the guard finds only the places already protected.

## What I keep

- Red against a missing module is not red. Red against a stub that answers constants is, and the count must be complete.
- An assertion that stays green against the stub is one to watch: covered by another, or decorative.
- When the guard came first, disable it and watch the test fall, then restore from a byte-level backup and `cmp`.
- Silence is not success. Read the exit code, read `Test Suites:`, and make the check say what it read before it says OK.
- A half-wired guard consumes the vigilance an absent one would not. Grep the callee, not the guard.
