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
5. Conflicts in `apps/web/locales/*.po`: take upstream's side, then run `pnpm lingui:extract`, which rebuilds the catalogs and refills en-US and en-GB (see **English catalogs** below).

## Keeping the fork cheap to maintain

- Prefer additive changes: new files and settings rather than edits spread through upstream code.
- Don't reformat or rename upstream code. Internal package names (`@reactive-resume/*`), the database and environment variable names stay as upstream has them.
- Strings added here ship in English; the fork may fill in translations that upstream's Crowdin doesn't cover.
- Upstream's GitHub Actions workflows stay disabled on this repository.

## Fork changes

| Change                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Since      | Status    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **AI limits.** Per-user Knowledge budgets and time limits for Coach, Assistant, application actions, web access, discovery and voice, in Settings → AI & developer. Column `career_profile.ai_limits`.                                                                                                                                                                                                                                                  | 2026-10-17 | Fork only |
| **Resume length.** A per-user number of pages (1 to 99, default 1) in Settings → Preferences. The editor's overflow warning, Fit and the assistant's tighten suggestion aim at it, or at the layout's pages if there are more. Column `user.resume_pages`.                                                                                                                                                                                              | 2026-10-17 | Fork only |
| **Knowledge ranked by relevance.** Application actions send the facts and stories that best match the posting and task first, the Coach the ones that best match each message (and the shared posting), and Coach search returns any-word matches best first. Keyword scoring (BM25) in `@reactive-resume/utils/relevance`, shared by web and API so the Coach's Used chips match what was sent. Unmatched facts still fill the budget, newest first.   | 2026-10-17 | Fork only |
| **Reasoning per AI connection.** Model default (sends nothing, as upstream), thinking off, or an effort from Minimal to Max, translated per provider by the AI SDK; Ultra passed through to OpenAI-compatible and OpenRouter. Applied in `getModel`, so every feature uses it. Column `ai_providers.reasoning`. Also: an action that reaches its time limit says so instead of failing as a server error, and clearer time-limit labels.                | 2026-10-17 | Fork only |
| **English catalogs.** The source locale is `en`, not `en-US`: upstream's text is mostly British with some US. After each extract, `tooling/locales/english.ts` fills en-US with the source in US spelling and en-GB's empty entries with the source; real translations in either are kept.                                                                                                                                                              | 2026-10-18 | Fork only |
| **Reminder settings.** Settings → Preferences → Reminders: the follow-up nudge for applications at Applied with no reply after 1 to 90 days (default 10, as upstream) or off, and the next-interview card on Career → Today on or off. Upstream's 10 days was a constant in `next-step.ts`. Columns `user.no_reply_days` and `user.interview_reminders`.                                                                                                | 2026-10-18 | Fork only |
| **Cobalt palette.** A palette choice in Settings → Preferences → Appearance, applied on top of Light, Dark or System: Cobalt (the default, GitHub's Primer neutrals with a blue accent) or Original (upstream's warm tokens). Cobalt overrides the tokens in `packages/ui/src/styles/globals.css` under `data-palette` on `<html>`, so upstream's blocks stay as they are; a `palette` cookie holds the choice, set before first paint in `index.html`. | 2026-10-18 | Fork only |
| **Live model prefill.** Adding an AI provider (in Settings or the assistant's Connect panel) fills in the newest model models.dev lists for it (within its main family, such as `claude-` or `command-`, where one is set), instead of upstream's hardcoded defaults from 2025 (`gpt-4.1`, `claude-3-5-sonnet-latest`). Blank if models.dev doesn't load; typing replaces it. `suggestedModel` in `apps/web/src/features/settings/ai/catalog.ts`.       | 2026-10-18 | Fork only |
| **Board first in Applications.** The Applications page opens on Board, now the first tab, instead of List. Phones still get List, since the board needs room to drag. `apps/web/src/routes/dashboard/applications/index.tsx`.                                                                                                                                                                                                                           | 2026-10-18 | Fork only |
