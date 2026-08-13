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
node --env-file=.env migrations/<file>.js            # dry-run
node --env-file=.env migrations/<file>.js --apply
node --env-file=.env migrations/<file>.js --verify
# or, if token is already exported:
node migrations/<file>.js
```

Env knobs (see `.env.example`): `DATABASE_ID`, `RATE_LIMITING_INTERVAL`, `ROW_LIMIT`.
