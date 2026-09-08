/** Move direct child pages from activities.findings_url into content-db.
 * Dry-run by default. --apply moves; --verify checks the saved journal and inboxes.
 * Keep .findings-state/ between runs: it records intent BEFORE each move.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const normalize = value => value?.replace(/-/g, '').toLowerCase();
function pageId(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['app.notion.com', 'www.notion.so', 'notion.so'].includes(url.hostname)) throw new Error('Invalid findings_url host');
  const id = url.pathname.match(/([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i)?.[1];
  if (!id) throw new Error('Invalid findings_url page ID');
  return normalize(id);
}
async function migrate({ request, state, save, mode = 'dry-run', env = process.env, log = console.log }) {
  const ACTIVITIES = env.ACTIVITIES_DATA_SOURCE_ID;
  const CONTENT = env.CONTENT_DATA_SOURCE_ID;
  for (const [name, id] of Object.entries({ ACTIVITIES_DATA_SOURCE_ID: ACTIVITIES, CONTENT_DATA_SOURCE_ID: CONTENT })) {
    if (!/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(id || '')) throw new Error(`Missing or invalid ${name}`);
  }
  const counts = { pending: 0, completed: 0, verified: 0 };
  async function list(route, method = 'get', body = {}) {
    const rows = [];
    let cursor;
    do {
      const params = { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) };
      const result = await request(route, method, method === 'get' ? undefined : { ...body, ...params }, method === 'get' ? params : undefined);
      rows.push(...result.results);
      if (result.has_more && (!result.next_cursor || result.next_cursor === cursor)) throw new Error('Invalid pagination cursor');
      cursor = result.has_more ? result.next_cursor : null;
    } while (cursor);
    return rows;
  }
  const schema = await request(`data_sources/${CONTENT}`);
  const relation = schema.properties?.Activity;
  if (relation?.type !== 'relation' || normalize(relation.relation?.data_source_id) !== normalize(ACTIVITIES)) throw new Error('Activity relation does not target activities-db');
  const activitiesSchema = await request(`data_sources/${ACTIVITIES}`);
  if (activitiesSchema.properties?.findings_url?.type !== 'url') throw new Error('findings_url must be a URL property');
  if (activitiesSchema.properties?.findings_synced_at?.type !== 'date') throw new Error('findings_synced_at must be a Date property');
  const activities = await list(`data_sources/${ACTIVITIES}/query`, 'post', { filter: { property: 'findings_url', url: { is_not_empty: true } } });
  activities.sort((a, b) => normalize(a.id).localeCompare(normalize(b.id)));
  const sources = new Map();
  const names = new Map();
  for (const activity of activities) {
    const source = pageId(activity.properties.findings_url.url);
    if (sources.has(source)) throw new Error('Multiple activities share a findings_url');
    sources.set(source, normalize(activity.id));
    const title = activity.properties.Name?.title || [];
    names.set(normalize(activity.id), title.map(t => t.plain_text || t.text?.content || '').join('').replace(/[\r\n\x1b]/g, ' ') || '(untitled)');
  }
  // Collect every page before moving: modifying a paginated list can skip items.
  const jobs = new Map(Object.entries(state));
  for (const [source, activity] of sources) {
    log(`[activity: ${names.get(activity)}] Starting scan`);
    const parent = await request(`pages/${source}`);
    if (parent.archived || parent.in_trash || normalize(parent.parent?.page_id) !== activity) throw new Error('Content page is not a live child of its activity');
    let found = 0;
    for (const block of await list(`blocks/${source}/children`)) {
      if (block.type !== 'child_page' || block.archived || block.in_trash) continue;
      found++;
      const id = normalize(block.id);
      const job = { source, activity };
      if (jobs.has(id) && (jobs.get(id).source !== source || jobs.get(id).activity !== activity)) throw new Error('Conflicting page assignment');
      jobs.set(id, job);
    }
    log(`[activity: ${names.get(activity)}] Found ${found} finding pages`);
  }
  for (const [id, job] of jobs) {
    if (!/^[a-f0-9]{32}$/.test(id) || sources.get(job.source) !== job.activity) throw new Error('Journal does not match current activities');
  }
  for (const activity of sources.values()) {
    const prefix = `[activity: ${names.get(activity)}]`;
    const before = { ...counts };
    log(`${prefix} Processing (${mode})`);
    try {
      for (const [id, job] of jobs) {
        if (job.activity !== activity) continue;
        let page = await request(`pages/${id}`);
        if (page.archived || page.in_trash) throw new Error('Candidate is archived');
        const inTarget = normalize(page.parent?.data_source_id) === normalize(CONTENT);
        if (!inTarget && normalize(page.parent?.page_id) !== job.source) throw new Error('Candidate was moved elsewhere');
        const prop = page.properties?.Activity;
        const related = prop?.relation || [];
        if (prop?.has_more || related.some(r => normalize(r.id) !== job.activity)) throw new Error('Candidate has a conflicting Activity relation');
        if (inTarget && related.some(r => normalize(r.id) === job.activity)) {
          counts.verified++;
          continue;
        }
        counts.pending++;
        if (mode !== 'apply') continue;
        state[id] = job;
        await save(state); // Durable intent also covers an ambiguous move response.
        if (!inTarget) await request(`pages/${id}/move`, 'post', { parent: { type: 'data_source_id', data_source_id: CONTENT } });
        await request(`pages/${id}`, 'patch', { properties: { Activity: { relation: [{ id: job.activity }] } } });
        page = await request(`pages/${id}`);
        if (normalize(page.parent?.data_source_id) !== normalize(CONTENT) || page.properties?.Activity?.relation?.length !== 1 || normalize(page.properties.Activity.relation[0].id) !== job.activity) throw new Error('Post-write verification failed');
        counts.completed++;
      }
      const pending = counts.pending - before.pending;
      const completed = counts.completed - before.completed;
      const verified = counts.verified - before.verified;
      if (mode === 'apply' && pending === completed) {
        await request(`pages/${activity}`, 'patch', { properties: { findings_synced_at: { date: { start: new Date().toISOString() } } } });
      }
      const result = mode === 'dry-run' ? `would move ${pending}` : mode === 'apply' ? `completed ${completed}, remaining ${pending - completed}` : `pending ${pending}`;
      log(`${prefix} Done: ${result}, verified ${verified}`);
    } catch (error) {
      log(`${prefix} Failed`);
      throw error;
    }
  }
  return counts;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => !['--apply', '--verify'].includes(a)) || args.length > 1) throw new Error('Use --apply OR --verify, or no arguments for dry-run');
  require('dotenv').config({ quiet: true });
  const token = process.env.NOTION_API_TOKEN || process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
  if (!token) throw new Error('Missing Notion API token');
  const interval = Number(process.env.RATE_LIMITING_INTERVAL || 350);
  if (!Number.isFinite(interval) || interval < 350) throw new Error('Invalid RATE_LIMITING_INTERVAL');
  // The installed SDK exposes request(); no global API-version/dependency upgrade.
  const { Client } = require('@notionhq/client');
  const client = new Client({ auth: token, notionVersion: '2026-03-11', logger: () => {} });
  const request = async (route, method = 'get', body, query) => {
    for (let attempt = 0; ; attempt++) {
      await sleep(interval);
      try { return await client.request({ path: route, method, body, query }); }
      catch (error) {
        if (error.status !== 429 || attempt >= 4) throw error;
        await sleep(Math.max(1000, Number(error.headers?.get?.('retry-after') || 1) * 1000));
      }
    }
  };
  const mode = args.includes('--apply') ? 'apply' : args.includes('--verify') ? 'verify' : 'dry-run';
  const directory = path.join(__dirname, '..', '.findings-state');
  const file = path.join(directory, 'journal.json');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  // ponytail: local lock only; hosting must provide a durable journal and single-run concurrency.
  const lock = await fs.open(path.join(directory, 'lock'), 'wx', 0o600);
  try {
    let state = {};
    try { state = JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid journal');
    const save = async value => {
      const handle = await fs.open(`${file}.tmp`, 'w', 0o600);
      try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(`${file}.tmp`, file);
    };
    const counts = await migrate({ request, state, save, mode,
      log: process.env.GITHUB_ACTIONS === 'true' ? () => {} : console.log,
    });
    console.log(JSON.stringify({ mode, ...counts }));
    if (mode === 'verify' && counts.pending) process.exitCode = 1;
  } finally {
    await lock.close();
    await fs.unlink(path.join(directory, 'lock'));
  }
}
module.exports = { migrate, pageId };
if (require.main === module) main().catch(error => {
  console.error(`Migration failed (${error.code || error.status || (process.env.GITHUB_ACTIONS === 'true' ? 'validation' : error.message)}). On hosted runs, an interrupted move may require manual Activity repair; local journal retained.`);
  process.exitCode = 1;
});
