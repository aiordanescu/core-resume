<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo/dark.svg" />
    <img src="docs/logo/light.svg" alt="All That Work" width="280" />
  </picture>

  <h1>Show all that work.</h1>

  <p>A job-search workspace for the experience behind your resume, the applications you send, and the interviews ahead.</p>

  <p>
    <a href="#what-you-can-do">Features</a> ·
    <a href="#what-this-fork-adds">What this fork adds</a> ·
    <a href="#self-hosting">Self-hosting</a> ·
    <a href="https://github.com/allthatwork/allthatwork/issues">Issues</a>
  </p>
</div>

All That Work keeps your career facts, stories, documents, and applications together so each opportunity starts with the experience you've already collected. Connect the AI models you choose, control the context they receive, and review their suggestions before using them.

This is an independently maintained fork of [Reactive Resume](https://github.com/reactive-resume/reactive-resume), released under the [MIT license](LICENSE). It is actively developed and used as a self-hosted application. A hosted product is in development; public signups are not open yet.

## What you can do

- **Keep your career knowledge.** Save accomplishments, skills, preferences, and interview stories. Group facts, review what goes into AI context, and keep selected information scoped to an application.
- **Write and tailor your documents.** Build resumes and cover letters with a live preview, templates, readability checks, and proposed AI edits you can accept or reject. Import existing documents and export PDF, Word, Markdown, or JSON.
- **Follow each application.** Save postings, track stages, contacts, notes, interviews, and follow-ups, and keep the documents you sent with the job they belong to.
- **Prepare for interviews.** Review the experience relevant to a role, draft application answers, practise interview responses, and keep debriefs and recruiter messages in the application's workspace.
- **Choose your AI.** Connect a supported provider or compatible endpoint, including local models. Set the context budgets, time limits, and supported reasoning effort that fit your connection.
- **Connect your own tools.** Use the REST API and MCP server for documents, career knowledge, and application workflows.

## What this fork adds

Reactive Resume provides the foundation: the resume and cover-letter editors, application tracker, career workspace, AI connections, and integrations. All That Work adds control over the parts that matter when you run a longer search with more career history or models that need more time.

| Area               | All That Work additions                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| AI context         | Per-account Knowledge budgets and relevance ranking against the posting, task, or coach message.  |
| Knowledge curation | Groups, private groups, application overrides, archiving, duplicate cleanup, and a budget meter.  |
| Time limits        | Per-account limits for AI actions, coach and assistant replies, web access, discovery, and voice. |
| Model reasoning    | Per-connection thinking controls, including the model default and supported effort levels.        |
| Resume length      | A preferred page count in Settings, used by overflow warnings, Fit, and tightening suggestions.   |
| Reminders          | Configurable follow-up timing and a switch for the next-interview card.                           |

Start with **Settings → AI & developer → AI limits** for context and timing, and **Career → Knowledge → Curate** to organize your experience. Limits retain upstream defaults until you change them.

[FORK.md](FORK.md) records the complete patch list, upstream status, branch model, and sync process. Internal package names and configuration keys retain Reactive Resume's names for compatibility.

## Self-hosting

There is no published All That Work container image yet. Build this checkout with Docker Engine and the Docker Compose plugin, or Docker Desktop.

For a local evaluation:

```bash
git clone --depth=1 https://github.com/allthatwork/allthatwork.git
cd allthatwork
cp .env.example .env
```

Edit `.env` before starting. Set `AUTH_SECRET` and `ENCRYPTION_SECRET` to separate random values. Run `openssl rand -hex 32` once for each secret. Keep `APP_URL=http://localhost:3000` for this local setup.

```bash
# Build All That Work and start PostgreSQL, Redis, and SeaweedFS.
docker compose up -d --build

# Inspect service status and application logs.
docker compose ps
docker compose logs --tail=100 reactive_resume
```

Open [http://localhost:3000](http://localhost:3000). The Compose service is still named `reactive_resume`; it builds All That Work from this repository. AI features need a connection configured in the app. Provider usage may have its own costs.

The supplied Compose file includes development credentials and publishes database and storage ports on the host. Before a public deployment, configure your own credentials, keep those services on private networks, and set up HTTPS, the correct `APP_URL`, and email delivery. See the [environment reference](docs/self-hosting/environment-variables.mdx) and [deployment examples](docs/self-hosting/examples.mdx) for the underlying configuration. Published Reactive Resume images and one-click templates install upstream builds.

The server applies migrations at startup. Back up your database and uploaded files before upgrading or switching an existing Reactive Resume installation, and use a fork build based on an upstream version at least as new as the one you are running.

## Documentation and development

The guides in this repository include the fork's changes:

- [Career workspace](docs/guides/career-overview.mdx)
- [Career knowledge and curation](docs/guides/building-career-knowledge.mdx)
- [AI connections and controls](docs/guides/using-ai.mdx)
- [Application tracking](docs/guides/tracking-job-applications.mdx)
- [Interview preparation](docs/guides/preparing-for-interview-day.mdx)
- [REST API](docs/guides/using-the-api.mdx) and [MCP server](docs/guides/using-the-mcp-server.mdx)
- [Development setup](docs/contributing/development.mdx) and [architecture](docs/contributing/architecture.mdx)

Local development uses Node.js 24 and the pnpm version pinned in `package.json`. Clone this repository when following the development guide; some inherited examples still use the upstream project name. The fork builds the web app and server; upstream's native mobile app remains in the source tree but is excluded from this fork's workspace.

[Reactive Resume's published documentation](https://docs.rxresu.me) is a useful reference for shared workflows and configuration. All That Work's features and setup are described here and in [FORK.md](FORK.md).

## Bugs and contributions

Use [this repository's issues](https://github.com/allthatwork/allthatwork/issues) for All That Work bugs and ideas. Changes land through pull requests to `main`; the `upstream` branch stays a mirror of Reactive Resume. Upstream contributions are considered separately.

You can use or self-host the software without joining the GitHub organization. Organization membership is by invitation.

## Credits and license

Built on [Reactive Resume](https://github.com/reactive-resume/reactive-resume) by Amruth Pillai. All That Work is independent and not affiliated with or endorsed by Reactive Resume. MIT licensed; see [LICENSE](LICENSE).
