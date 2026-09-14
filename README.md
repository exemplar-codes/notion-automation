# notion-automation

Manual Notion automations and one-off migrations.

## Setup

```sh
pnpm install --frozen-lockfile
source ~/.zshrc && source ~/.env
# Create project configuration only if it does not already exist:
[ -f .env ] || cp .env.example .env
```

Keep your Notion API token in the global environment (usually `~/.env`). The
accepted names, in priority order, are `NOTION_API_TOKEN`, `NOTION_TOKEN`, and
`NOTION_API_KEY`. Use the API integration token, not `NOTION_MCP_KEY`. Avoid
setting multiple token aliases: a higher-priority placeholder can mask a valid key.
The project `.env` is gitignored and supplies values missing from the exported
environment; exported values take precedence. Do not commit or print credentials.

Fill the project `.env` with the IDs for your workspace:

```dotenv
ACTIVITIES_DATABASE_ID=<activities-db database ID>
CONTENT_DATABASE_ID=<content-db database ID>
ACTIVITIES_DATA_SOURCE_ID=<activities-db data source ID>
CONTENT_DATA_SOURCE_ID=<content-db data source ID>
RATE_LIMITING_INTERVAL=350
FINDINGS_CONCURRENCY=5
```

Database IDs are used by the health check and session-URL migration. Data-source
IDs are used by the findings migration; these are different IDs and must not be
substituted for one another. Share both databases and source content pages with
the API integration. Being able to see a page through MCP does not establish
that the separate API integration can access it.

### Instructions for coding agents setting up this repository

1. Read this README and `.env.example`. Preserve any existing project `.env`.
2. Source `~/.zshrc` and `~/.env` to reuse available global credentials and IDs.
   Check variable presence without printing secret values. Do not ask the user
   to paste a token if the correct API token is already available globally.
3. For missing IDs, use Notion MCP to find `activities-db` and `content-db`, then
   fetch their database/data-source metadata. Resolve each database container ID
   and its data-source ID separately. Reuse verified global IDs when available;
   never invent IDs or hardcode workspace IDs in migration source files.
4. Write the resolved IDs and migration settings into the gitignored project
   `.env`. Keep credentials in the global environment when already configured.
   Additional content pages come from activity properties `findings_url` and
   `findings_url_all` (legacy alias `finding_urls_all`), not code constants.
5. Run `npm run health` to verify read access using the API integration. If an ID,
   credential, or permission is still missing after discovery, report exactly
   what is missing. Do not run a migration merely to test setup: migrations write
   immediately and should run only when requested.

Use `npm run help` for commands and `npm run migrations -- ls` for migration names.

## Read-only health check

```sh
source ~/.zshrc && source ~/.env
npm run health
```

Uses the same authentication as existing scripts (`NOTION_API_TOKEN`,
`NOTION_TOKEN`, or `NOTION_API_KEY`; optional local `.env`). Checks identity,
database schemas and a one-row query for activities-db and content-db. Prints
only check status, exits nonzero on failure, and never writes to Notion.
Set `ACTIVITIES_DATABASE_ID` and `CONTENT_DATABASE_ID` in the environment.
This does not prove write permissions or page-move support.

## Layout

| Path | Role |
|------|------|
| `setup.js` | Notion client + logger |
| `lib.js` | Shared helpers (`traverseRows`, rate limit) |
| `index.js` | Scratch / ad-hoc experiments |
| `migrations/` | **History of custom migration scripts** — one file per job; keep them |
| `reports/` | Local execution JSON outputs — **aggregates only** (counts/mode); no row titles/URLs/ids. Still gitignored by default |

## Run a migration

Migrations execute immediately: `npm run migrate -- <name>`. There are no dry-run, apply, or verify modes.

Run `npm run help` for setup and usage examples, or `npm run migrations -- ls`
to list available migration names (excluding tests). Neither command needs credentials or calls Notion.

Use the shared migration entry point. It loads the optional project `.env`, checks
credentials and required IDs, then runs the named migration. Exported environment
variables take precedence. Migration-specific behavior stays in individual files.

```sh
npm run migrate -- <name>
npm run migrations -- ls
```

Env knobs (see `.env.example`): `DATABASE_ID`, `RATE_LIMITING_INTERVAL`, `ROW_LIMIT`.

## Activity findings → content-db

Set `ACTIVITIES_DATA_SOURCE_ID` and `CONTENT_DATA_SOURCE_ID` (not the database
container IDs). All four ID variables are documented in `.env.example`; there
are no workspace ID defaults. The older session-url migration uses
`CONTENT_DATABASE_ID`, with `DATABASE_ID` retained as a legacy fallback.

`migrations/activity-findings-to-content-db.js` uses each activity's
`findings_url` to move its direct child pages into content-db and set `Activity`, adding `migration` to `Tags` while preserving existing tags.
Optional `findings_url_all` text (also accepts `finding_urls_all`) can contain additional Notion page URLs (plain text, hyperlinks, or Notion page mentions). These are combined with `findings_url` and deduplicated per activity; other links and text are ignored. Activities with only additional URLs are included too. All sources for an activity are scanned before its findings are moved. The Active checkbox does not filter activities.
The original page ID, body and nested content stay with the moved page. It leaves
its old parent's child-page list. Links to pages, inline databases and nested
pages are not separately migrated; no filtered views or columns are created.

```sh
# After sourcing ~/.zshrc and ~/.env (or supplying a local .env):
npm run migrate -- activity-findings-to-content-db
node migrations/activity-findings-to-content-db.test.js    # offline checks
```

Uses the existing SDK's `request()` with API version `2026-03-11`; older migrations
are unchanged. Grant the integration access to activities-db, its content pages,
and content-db. The migration validates the `Activity` relation target and uses `findings_url` as
the source of truth, regardless of where the content page is located. It refuses ambiguous
assignments, archived candidates, or pages moved elsewhere. All activities and their direct findings are processed without a limit.
`RATE_LIMITING_INTERVAL` defaults to 350 ms and cannot be lower; 429s are retried.

**Recovery:** `.findings-state/journal.json` records page IDs and their activity
before moving. It is private, gitignored state, separate from aggregate reports.
Retain it between runs: if relation assignment fails after moving, rerunning repairs
A lost journal loses that recovery mapping. No credentials or page content are
written there; output includes activity names with `[activity: activity_name]` prefixes, findings counts
(including zero), processing mode and completion/failure status, plus aggregate counts.
Do not run from multiple worktrees/devices concurrently.

Local runs retain the journal. Hosted runs intentionally do not persist it, so
a move followed by a failed Activity update requires manual repair.
A live run moved one finding and verified its destination and Activity relation.

A complete successful apply, including zero findings, updates `findings_synced_at`.
Failures do not update it. The Date property must exist.

## Hosting: GitHub Actions

`.github/workflows/findings-sync.yml` runs hourly at minute 17 (UTC), plus manual
**Run workflow**. Standard runners are free for this public repository. GitHub
may delay schedules and disables public-repository schedules after 60 days without
repository activity; re-enable the workflow in Actions if that happens.

Required repository Actions secrets: `NOTION_API_KEY`,
`ACTIVITIES_DATA_SOURCE_ID`, `CONTENT_DATA_SOURCE_ID`. No IDs or tokens are in the
workflow. Runs have read-only repository permissions, a 15-minute timeout and a
shared concurrency group. No PR/push trigger receives Notion credentials.

Hosted logs contain aggregate counts only, not activity names or finding content.
No journal artifacts/caches are uploaded. As explicitly chosen, there is no durable
hosted recovery journal: inspect content-db and repair Activity manually if a run
fails after a move. Do not overlap a local apply with a hosted run. The first
hosted run verifies new moves; historical local journal entries are not imported.

Set `FINDINGS_CONCURRENCY` (default `5`) to control parallel findings within each activity. Each page still moves, updates, and verifies in order. API request starts share `RATE_LIMITING_INTERVAL`; journal saves stay serialized. On failure, in-flight pages finish before the next activity starts.
