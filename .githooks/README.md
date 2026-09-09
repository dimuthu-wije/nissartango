# .githooks

Git hooks that are **in the repo** rather than in `.git/hooks`.

`.git/hooks` is not tracked, does not clone, and does not survive a fresh
checkout — which makes it the wrong place for a control whose whole job is to
still be there on the day someone is moving fast. These live in git and are
activated by pointing git at them:

```bash
npm run hooks:install     # git config core.hooksPath .githooks
```

`npm install` does it too, via the `prepare` script, so a fresh clone that
installs dependencies is protected without anyone remembering this file.

Check it took:

```bash
git config core.hooksPath        # -> .githooks
```

## pre-commit

Three refusals, in order:

1. **Any `.env` file is staged.** `.env`, `.env.local`, `config/.env.anything`,
   at any depth. `.env.example` is the single exception. `.env` is about to
   hold `DEV_DB_URL` and `PROD_DB_URL` — full database credentials for a live
   project, in a public repository.
2. **`.gitignore` has stopped ignoring `.env`.** This runs on *every* commit,
   not only when a `.env` is staged, because the dangerous window is the one
   where the rule is missing and no `.env` exists yet. It has happened twice
   here, both times an agent writing a file it could not read.
3. **A secret key shape appears in staged content** — `sb_secret_…` or a JWT
   triple. Deliberately narrow: connection URIs are *not* matched, because
   `.env.example` and `PROJECT_SETUP.md` legitimately document their form. A
   hook with false positives is a hook people learn to `--no-verify` past,
   which is worse than no hook. Verified silent against every tracked file in
   this repo.

## On `--no-verify`

It works. That is deliberate — a control you cannot bypass in an emergency gets
removed instead. But understand the asymmetry before you reach for it: a
refused commit costs ten seconds, and a credential that reaches a public repo
costs a rotation, permanently. Force-pushing does not unpublish it; forks keep
copies and unreachable objects stay addressable.

This is a second line, not the first. `.gitignore` is still the mechanism —
this is what notices when `.gitignore` is wrong.
