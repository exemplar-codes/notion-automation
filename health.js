/** Read-only authentication and database-access check. Never prints credentials or page data. */
async function health(notion, log = console.log, env = process.env) {
  const targets = [
    ['activities-db', env.ACTIVITIES_DATABASE_ID],
    ['content-db', env.CONTENT_DATABASE_ID],
  ];
  for (const [name, id] of targets) {
    if (!/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(id || '')) {
      throw new Error(`Missing or invalid database ID for ${name}`);
    }
  }
  await notion.users.me({});
  log('OK authentication');
  for (const [name, database_id] of targets) {
    await notion.databases.retrieve({ database_id });
    await notion.databases.query({ database_id, page_size: 1 });
    log(`OK ${name}: schema and row reads`);
  }
  log('HEALTH OK (read access only; write permissions not tested)');
}
module.exports = { health };
if (require.main === module) {
  const { notion } = require('./setup');
  health(notion).catch(error => {
    const status = Number.isInteger(error.status) ? error.status : 'unavailable';
    console.error(`HEALTH FAILED (HTTP ${status}). Check token, integration capabilities and database sharing.`);
    process.exitCode = 1;
  });
}
