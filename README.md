# notion-automation

Manual Notion automations and one-off migrations.

## Setup

```sh
pnpm i
# Auth / common env vars are usually already in the shell (~/.zshrc → ~/.env).
# Optional local overrides:
cp .env.example .env   # set NOTION_API_TOKEN if not sourced from the shell
```

Share the target database with your Notion integration before running anything.

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
| `reports/` | Local dry-run/apply JSON outputs — **aggregates only** (counts/mode); no row titles/URLs/ids. Still gitignored by default |

## Run a migration

From a shell that has sourced `~/.zshrc` (so `NOTION_API_TOKEN` is set), or with a local `.env`:

```sh
node --env-file=.env migrations/<file>.js            # dry-run (quiet summary)
node --env-file=.env migrations/<file>.js --apply
node --env-file=.env migrations/<file>.js --verify
node --env-file=.env migrations/<file>.js --apply --verbose   # per-row titles
# or, if token is already exported:
node migrations/<file>.js
```

Env knobs (see `.env.example`): `DATABASE_ID`, `RATE_LIMITING_INTERVAL`, `ROW_LIMIT`.

## Activity findings → content-db

Set `ACTIVITIES_DATA_SOURCE_ID` and `CONTENT_DATA_SOURCE_ID` (not the database
container IDs). All four ID variables are documented in `.env.example`; there
are no workspace ID defaults. The older session-url migration uses
`CONTENT_DATABASE_ID`, with `DATABASE_ID` retained as a legacy fallback.

`migrations/activity-findings-to-content-db.js` uses each activity's
`findings_url` to move its direct child pages into content-db and set `Activity`.
All activities with a URL are included, irrespective of their Active checkbox.
The original page ID, body and nested content stay with the moved page. It leaves
its old parent's child-page list. Links to pages, inline databases and nested
pages are not separately migrated; no filtered views or columns are created.

```sh
# After sourcing ~/.zshrc and ~/.env (or supplying a local .env):
node migrations/activity-findings-to-content-db.js          # read-only preview
node migrations/activity-findings-to-content-db.js --apply
node migrations/activity-findings-to-content-db.js --verify
node migrations/activity-findings-to-content-db.test.js    # offline checks
```

Uses the existing SDK's `request()` with API version `2026-03-11`; older migrations
are unchanged. Grant the integration access to activities-db, its content pages,
and content-db. The migration validates the `Activity` relation target and requires
each content page to be a direct child of its activity. It refuses ambiguous
assignments, archived candidates, or pages moved elsewhere. All activities and their direct findings are processed without a limit.
`RATE_LIMITING_INTERVAL` defaults to 350 ms and cannot be lower; 429s are retried.

**Recovery:** `.findings-state/journal.json` records page IDs and their activity
before moving. It is private, gitignored state, separate from aggregate reports.
Retain it between runs: if relation assignment fails after moving, rerunning repairs
that same page. Completed entries let `--verify` check both destination and Activity.
A lost journal loses that recovery mapping. No credentials or page content are
written there; output includes activity names with `[activity: activity_name]` prefixes, findings counts
(including zero), processing mode and completion/failure status, plus aggregate counts. A crash may leave
`.findings-state/lock`; remove it only after confirming no migration is running.
Do not run from multiple worktrees/devices concurrently.

Hosting is deferred. Before scheduling on ephemeral runners, provide durable private
journal storage and single-run concurrency; do not simply schedule this script as-is.
A live run moved one finding and verified its destination and Activity relation.

A complete successful apply, including zero findings, updates `findings_synced_at`.
Dry-run, verification and failures do not update it. The Date property must exist.
