const { readdirSync } = require('node:fs');
const path = require('node:path');

const { spawnSync } = require('node:child_process');
const names = readdirSync(path.join(__dirname, 'migrations'), { withFileTypes: true })
  .filter(file => file.isFile() && file.name.endsWith('.js') && !file.name.endsWith('.test.js'))
  .map(file => file.name.slice(0, -3)).sort();

const [command = 'help', ...extra] = process.argv.slice(2);
if (command === 'run') {
  try {
    const [name, ...args] = extra;
    if (!names.includes(name)) throw new Error('Choose a migration name from npm run migrations -- ls');
    if (args.some(arg => ['--apply', '--verify', '--dry-run'].includes(arg))) throw new Error('Mode flags were removed; run the migration by name to execute directly');
    require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
    if (!(process.env.NOTION_API_TOKEN || process.env.NOTION_TOKEN || process.env.NOTION_API_KEY)) throw new Error('Missing Notion API token; set NOTION_API_KEY');
    const required = name === 'activity-findings-to-content-db'
      ? ['ACTIVITIES_DATA_SOURCE_ID', 'CONTENT_DATA_SOURCE_ID']
      : name === 'content-db-session-url-to-url' ? [process.env.CONTENT_DATABASE_ID ? 'CONTENT_DATABASE_ID' : 'DATABASE_ID'] : [];
    for (const key of required) {
      if (!/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(process.env[key] || '')) throw new Error(`Missing or invalid ${key}; configure project .env`);
    }
    console.log(`Migration: ${name}`);
    const result = spawnSync(process.execPath, [path.join(__dirname, 'migrations', `${name}.js`), ...args], { stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else if (extra.length || !['help', '--help', 'ls'].includes(command)) {
  console.error('Usage: npm run help | npm run migrations -- ls');
  process.exitCode = 1;
} else if (command === 'ls') {
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
  npm run migrate -- <name>              Execute changes in Notion

Findings example:
  npm run migrate -- activity-findings-to-content-db
  FINDINGS_CONCURRENCY=5 npm run migrate -- activity-findings-to-content-db

Findings requires ACTIVITIES_DATA_SOURCE_ID and CONTENT_DATA_SOURCE_ID.
Session URL migration uses CONTENT_DATABASE_ID (or legacy DATABASE_ID).
Keep .findings-state/ for recovery. Do not overlap local and hosted runs.
See README.md for migration-specific options and recovery details.`);
}
