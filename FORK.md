# Overreactive Resume

Overreactive Resume is a downstream fork of [Reactive Resume](https://github.com/reactive-resume/reactive-resume). It follows upstream closely and adds what its maintainer needs for a self-hosted job search. Changes that suit everyone may be offered upstream; the rest stay here.

This file is the fork's patch list: every change that is not in upstream, and where it stands.

## Branches

| Branch                      | What it holds                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `main`                      | Overreactive Resume: upstream plus the fork's changes. The default branch and what gets deployed. Changes land only through pull requests. |
| `upstream`                  | An exact mirror of `reactive-resume/reactive-resume:main`. It only fast-forwards and never carries fork commits.                           |
| `feat/*`, `fix/*`, `docs/*` | Work in progress, cut from `main` and merged back into `main` with a merge commit.                                                         |

A change offered upstream gets its own branch cut from `upstream`, so the upstream pull request carries only that change.

## Syncing with upstream

1. Fast-forward `upstream`: `git fetch upstream && git push origin upstream/main:refs/heads/upstream`.
2. Open a pull request from `upstream` into `main` titled `Merge upstream <version or date>`, resolve any conflicts there, and merge it with a merge commit. `main` is never rebased or force-pushed.
3. Sync at upstream release tags by default; take an untagged upstream commit only when a specific fix is needed sooner.
4. When upstream merges a change that started here, resolve conflicts in favor of upstream's version and mark it **Upstream** below.

## Keeping the fork cheap to maintain

- Prefer additive changes: new files and settings rather than edits spread through upstream code.
- Don't reformat or rename upstream code. Internal package names (`@reactive-resume/*`), the database and environment variable names stay as upstream has them.
- Strings added here ship in English; the fork may fill in translations that upstream's Crowdin doesn't cover.
- Upstream's GitHub Actions workflows stay disabled on this repository.

## Fork changes

| Change                                                                                                                                                                                                 | Since      | Status    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **AI limits.** Per-user Knowledge budgets and time limits for Coach, Assistant, application actions, web access, discovery and voice, in Settings → AI & developer. Column `career_profile.ai_limits`. | 2026-10-17 | Fork only |
