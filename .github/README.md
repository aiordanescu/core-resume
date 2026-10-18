# Overreactive Resume

A self-hosted fork of [Reactive Resume](https://github.com/reactive-resume/reactive-resume) for running a serious job search with the AI models you choose.

Overreactive Resume keeps everything Reactive Resume does: the resume and cover letter editor, the job application tracker, the career coach, the REST API and the MCP server. It changes the parts that get in the way when you run it yourself, at volume, on your own models.

## Why it exists

It grew out of a real job search: hundreds of career facts, dozens of applications, and AI served from a local inference box through a self-hosted gateway. Reactive Resume handled the workflow well, but its AI limits were fixed for small, fast hosted models. Most of the Knowledge never reached the AI, and slower local models ran out of time. This fork fixes what that search ran into, and follows Reactive Resume for everything else.

## What's different

| Area                       | Reactive Resume                                                                                                                                          | Overreactive Resume                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| How much Knowledge AI sees | Fixed: the coach gets 30 facts and 8 stories; Fit, Apply, Prepare and the other application actions get 10,000 characters of facts and 10,000 of stories | Set per account in **Settings → AI & developer → AI limits**, up to 1,000,000 characters                     |
| Which Knowledge AI sees    | The newest facts and stories first, until the budget is full                                                                                             | The ones that best match the posting, the task or your message first; the rest fill any space left           |
| How long AI may run        | Fixed: 120 s per application action, 240 s per coach or assistant reply, 120 s per model call                                                            | Set per account, up to 15 minutes for an action and 14 for a reply                                           |
| How hard the AI thinks     | Not set: each model uses its server's default, which can be its highest and slowest effort                                                               | Set per AI connection: model default, thinking off, or an effort from Minimal to Max (Ultra where supported) |
| Web access and discovery   | Fixed: 20 s per web search or page read, 90 s per scheduled discovery run                                                                                | Set per account in **Web access → Time limits**                                                              |
| Voice                      | Fixed: 60 s to transcribe, 30 s to read aloud                                                                                                            | Set per account                                                                                              |
| Resume length              | One page, unless you add pages to each resume's layout and move sections onto them by hand                                                               | Set per account in **Settings → Preferences**, 1 to 99 pages; content flows onto them                        |

Limits default to Reactive Resume's values, so nothing changes until you raise one. [FORK.md](../FORK.md) lists every change, with its status upstream.

On the way:

- Smarter matching for Knowledge worded differently from the posting (a cloud landing zone that your facts call EKS).
- Deeper job discovery: more searches, more results, and filters.

## Getting started

There's no hosted version and no published image yet. Build it from source with Docker and Docker Compose:

```bash
git clone --depth=1 https://github.com/aiordanescu/overreactive-resume.git
cd overreactive-resume

# Set AUTH_SECRET and a separate ENCRYPTION_SECRET in .env.
# Generate each with: openssl rand -hex 32
cp .env.example .env

# Build the app and start PostgreSQL, Redis and SeaweedFS
docker compose up -d --build
```

Then open http://localhost:3000. For everything else, such as configuration, storage, AI providers, single sign-on and deployment options, [Reactive Resume's documentation](https://docs.rxresu.me) applies as written.

## Switching from Reactive Resume

Point Overreactive Resume at your existing Reactive Resume database and upload storage, and use a build at least as new as your Reactive Resume version. On startup it applies Reactive Resume's migrations plus its own, which only add to the schema. Back up your database first.

You can switch back. Reactive Resume keeps working with the extra columns: its startup schema check logs them and carries on, unless you set `STRICT_SCHEMA_CHECK=true`.

## Staying close to upstream

The `upstream` branch mirrors Reactive Resume, and `main` merges it at each release. Fork changes stay additive and keep Reactive Resume's internal names, so new releases arrive quickly. Changes that suit every Reactive Resume user may be offered upstream.

Found a bug or have an idea? [Open an issue](https://github.com/aiordanescu/overreactive-resume/issues). If it also happens in Reactive Resume itself, report it [upstream](https://github.com/reactive-resume/reactive-resume/issues) too.

## Credits and license

Reactive Resume is created by [Amruth Pillai](https://github.com/AmruthPillai) and its contributors, and nearly all of this project is their work. If it's useful to you, consider [supporting Reactive Resume](https://opencollective.com/reactive-resume).

Overreactive Resume is not affiliated with or endorsed by Reactive Resume. Like Reactive Resume, it's released under the [MIT license](../LICENSE).
