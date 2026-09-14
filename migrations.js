const { readdirSync } = require('node:fs');
const path = require('node:path');

const [command = 'help', ...extra] = process.argv.slice(2);
if (extra.length || !['help', '--help', 'ls'].includes(command)) {
  console.error('Usage: npm run help | npm run migrations -- ls');
  process.exitCode = 1;
} else if (command === 'ls') {
  const names = readdirSync(path.join(__dirname, 'migrations'), { withFileTypes: true })
    .filter(file => file.isFile() && file.name.endsWith('.js') && !file.name.endsWith('.test.js'))
    .map(file => file.name.slice(0, -3)).sort();
  console.log(names.join('\n') || 'No migrations found.');
} else {
  console.log(`Notion migrations

Setup (before running a migration):
  source ~/.zshrc && source ~/.env
  Set the required IDs and API token listed in .env.example.
  A local .env is also supported. Share the target pages/databases with the integration.

Discover:
  npm run migrations -- ls
  npm run health                        Read-only connection check

Run any migration (replace <name> with a name from the list):
  node migrations/<name>.js              Dry-run: preview without writes
  node migrations/<name>.js --apply      Apply changes to Notion
  node migrations/<name>.js --verify     Verify migration results

Findings example:
  node migrations/activity-findings-to-content-db.js --apply
  FINDINGS_CONCURRENCY=5 node migrations/activity-findings-to-content-db.js --apply

Findings requires ACTIVITIES_DATA_SOURCE_ID and CONTENT_DATA_SOURCE_ID.
Session URL migration uses CONTENT_DATABASE_ID (or legacy DATABASE_ID).
Keep .findings-state/ for recovery. Do not overlap local and hosted runs.
See README.md for migration-specific options and recovery details.`);
}
