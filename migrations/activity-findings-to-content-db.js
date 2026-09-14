/** Move direct child pages from activities.findings_url into content-db.
 * Runs immediately; journal entries recover interrupted moves.
 * Keep .findings-state/ between runs: it records intent BEFORE each move.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const normalize = value => value?.replace(/-/g, '').toLowerCase();
function pageId(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !(['app.notion.com', 'www.notion.so', 'notion.so', 'notion.site'].includes(url.hostname) || url.hostname.endsWith('.notion.site'))) throw new Error('Invalid findings_url host');
  const id = url.pathname.match(/([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i)?.[1];
  if (!id) throw new Error('Invalid findings_url page ID');
  return normalize(id);
}
function extraSources(property) {
  const rich = property?.rich_text || [];
  const text = [property?.url || '', rich.map(part => part.plain_text ?? part.text?.content ?? '').join(''),
    ...rich.map(part => part.href || part.text?.link?.url || (part.mention?.type === 'page' && part.mention.page?.id ? `https://notion.so/${part.mention.page.id}` : ''))].join(' ');
  const ids = new Set();
  for (const match of text.matchAll(/https:\/\/[^\s<>"'\[\]()]+/g)) {
    try { ids.add(pageId(match[0].replace(/[.,;!?]+$/, ''))); } catch { /* Ignore prose, non-Notion links and invalid page URLs. */ }
  }
  return ids;
}
async function migrate({ request, state, save, env = process.env, log = console.log, onError = (prefix, error) => log(`${prefix} Failed: ${error.message}`) }) {
  const ACTIVITIES = env.ACTIVITIES_DATA_SOURCE_ID;
  const CONTENT = env.CONTENT_DATA_SOURCE_ID;
  for (const [name, id] of Object.entries({ ACTIVITIES_DATA_SOURCE_ID: ACTIVITIES, CONTENT_DATA_SOURCE_ID: CONTENT })) {
    if (!/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(id || '')) throw new Error(`Missing or invalid ${name}`);
  }
  const concurrency = Number(env.FINDINGS_CONCURRENCY || 5);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('FINDINGS_CONCURRENCY must be a positive integer');
  let journalQueue = Promise.resolve();
  const forget = async id => {
    journalQueue = journalQueue.then(async () => {
      const job = state[id];
      delete state[id];
      try { await save(state); }
      catch (error) { state[id] = job; throw error; }
    });
    await journalQueue;
  };
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
  if (schema.properties?.Tags?.type !== 'multi_select') throw new Error('Tags must be a multi-select property');
  const relation = schema.properties?.Activity;
  if (relation?.type !== 'relation' || normalize(relation.relation?.data_source_id) !== normalize(ACTIVITIES)) throw new Error('Activity relation does not target activities-db');
  const activitiesSchema = await request(`data_sources/${ACTIVITIES}`);
  if (activitiesSchema.properties?.findings_url?.type !== 'url') throw new Error('findings_url must be a URL property');
  if (activitiesSchema.properties?.findings_synced_at?.type !== 'date') throw new Error('findings_synced_at must be a Date property');
  const activities = await list(`data_sources/${ACTIVITIES}/query`, 'post');
  activities.sort((a, b) => normalize(a.id).localeCompare(normalize(b.id)));
  const sources = new Map();
  const names = new Map();
  const activitySources = new Map();
  const skipped = new Set();
  for (const activity of activities) {
    if (activity.archived || activity.in_trash) {
      skipped.add(normalize(activity.id));
      continue;
    }
    const ids = new Set([...extraSources(activity.properties.findings_url_all), ...extraSources(activity.properties.finding_urls_all)]);
    if (activity.properties.findings_url?.url) ids.add(pageId(activity.properties.findings_url.url));
    if (!ids.size) continue;
    const activityId = normalize(activity.id);
    for (const source of ids) {
      if (sources.has(source) && sources.get(source) !== activityId) throw new Error('Multiple activities share a findings URL');
      sources.set(source, activityId);
    }
    activitySources.set(activityId, ids);
    const title = activity.properties.Name?.title || [];
    names.set(normalize(activity.id), env.GITHUB_ACTIONS === 'true' ? `#${names.size + 1}` : title.map(t => t.plain_text || t.text?.content || '').join('').replace(/[\r\n\x1b]/g, ' ') || '(untitled)');
  }
  for (const [id, job] of Object.entries(state)) {
    if (skipped.has(job.activity)) continue;
    if (!/^[a-f0-9]{32}$/.test(id) || sources.get(job.source) !== job.activity) throw new Error('Journal does not match current activities');
  }
  for (const [activity, contentSources] of activitySources) {
    const prefix = `[activity: ${names.get(activity)}]`;
    const before = { ...counts };
    // Finish this activity's pagination before moving its pages.
    const jobs = new Map(Object.entries(state).filter(([, job]) => job.activity === activity));
    const contentPrefixes = new Map();
    let errorPrefix = prefix;
    log(`${prefix} Starting scan`);
    try {
      let found = 0, liveSources = 0, scanned = 0;
      for (const source of contentSources) {
        log(`${prefix} Scanning content page ${++scanned}/${contentSources.size}`);
        const parent = await request(`pages/${source}`);
        const title = Object.values(parent.properties || {}).find(property => Array.isArray(property.title))?.title || [];
        const name = env.GITHUB_ACTIONS === 'true' ? `#${scanned}` : title.map(part => part.plain_text || part.text?.content || '').join('').replace(/[\r\n\x1b]/g, ' ') || '(untitled)';
        const contentPrefix = `${prefix} [content: ${name}]`;
        contentPrefixes.set(source, contentPrefix);
        errorPrefix = contentPrefix;
        log(`${contentPrefix} Scanning findings`);
        const foundBefore = found;
        if (parent.archived || parent.in_trash) {
          log(`${contentPrefix} Skipped: content page is trashed`);
          for (const [id, job] of jobs) if (job.source === source) jobs.delete(id);
          continue;
        }
        liveSources++;
        for (const block of await list(`blocks/${source}/children`)) {
          if (block.type !== 'child_page' || block.archived || block.in_trash) continue;
          found++;
          const id = normalize(block.id);
          const job = { source, activity };
          if (jobs.has(id) && (jobs.get(id).source !== source || jobs.get(id).activity !== activity)) throw new Error('Conflicting page assignment');
          jobs.set(id, job);
        }
        log(`${contentPrefix} Found ${found - foundBefore} finding pages`);
      }
      errorPrefix = prefix;
      if (!liveSources) continue;
      log(`[activity: ${names.get(activity)}] Found ${found} finding pages`);
      log(`${prefix} Processing: ${jobs.size} findings, concurrency ${concurrency}`);
      let handled = 0, skippedFindings = 0;
      const progress = source => log(`${contentPrefixes.get(source) || prefix} Progress: ${handled}/${jobs.size} handled, ${jobs.size - handled} left; completed ${counts.completed - before.completed}, verified ${counts.verified - before.verified}, skipped ${skippedFindings}`);
      progress();
      const migratePage = async (id, job) => {
        // Fresh findings were just listed under the source; only recovery needs a pre-read.
        let page = state[id] ? await request(`pages/${id}`) : { parent: { page_id: job.source } };
        if (page.archived || page.in_trash) {
          skippedFindings++;
          handled++;
          progress(job.source);
          return;
        }
        const inTarget = normalize(page.parent?.data_source_id) === normalize(CONTENT);
        if (!inTarget && normalize(page.parent?.page_id) !== job.source) throw new Error('Candidate was moved elsewhere');
        const prop = page.properties?.Activity;
        const related = prop?.relation || [];
        if (prop?.has_more || related.some(r => normalize(r.id) !== job.activity)) throw new Error('Candidate has a conflicting Activity relation');
        if (inTarget && related.some(r => normalize(r.id) === job.activity) && page.properties?.Tags?.multi_select?.some(tag => tag.name === 'migration')) {
          await forget(id);
          counts.verified++;
          handled++;
          progress(job.source);
          return;
        }
        counts.pending++;
        state[id] = job;
        journalQueue = journalQueue.then(() => save(state));
        await journalQueue; // Serialize durable intent before each move.
        if (!inTarget) await request(`pages/${id}/move`, 'post', { parent: { type: 'data_source_id', data_source_id: CONTENT } });
        // Read after moving so destination tags/defaults are preserved too.
        if (!inTarget) page = await request(`pages/${id}`);
        const tags = [...new Set([...(page.properties?.Tags?.multi_select || []).map(tag => tag.name), 'migration'])];
        await request(`pages/${id}`, 'patch', { properties: {
          Activity: { relation: [{ id: job.activity }] },
          Tags: { multi_select: tags.map(name => ({ name })) },
        } });
        page = await request(`pages/${id}`);
        if (normalize(page.parent?.data_source_id) !== normalize(CONTENT) || page.properties?.Activity?.relation?.length !== 1 || normalize(page.properties.Activity.relation[0].id) !== job.activity || !page.properties?.Tags?.multi_select?.some(tag => tag.name === 'migration')) throw new Error('Post-write verification failed');
        await forget(id);
        counts.completed++;
        handled++;
        progress(job.source);
      };
      const remaining = jobs.entries();
      let failure;
      await Promise.all(Array.from({ length: Math.min(concurrency, jobs.size) }, async () => {
        while (!failure) {
          const next = remaining.next();
          if (next.done) return;
          try { await migratePage(...next.value); }
          catch (error) {
            if (!failure) errorPrefix = contentPrefixes.get(next.value[1].source) || prefix;
            failure ||= error;
          }
        }
      }));
      // Let in-flight pages finish before reporting failure or starting another activity.
      if (failure) throw failure;
      const pending = counts.pending - before.pending;
      const completed = counts.completed - before.completed;
      const verified = counts.verified - before.verified;
      if (pending === completed) {
        log(`${prefix} ${jobs.size === 0 ? 'No findings; updating' : 'Updating'} last-sync timestamp…`);
        await request(`pages/${activity}`, 'patch', { properties: { findings_synced_at: { date: { start: new Date().toISOString() } } } });
      }
      log(`${prefix} Done: moved ${completed}, already migrated ${verified}`);
    } catch (error) {
      onError(errorPrefix, error);
    }
  }
  return counts;
}
async function main() {
  if (process.argv.length > 2) throw new Error('This migration takes no flags; run it by name to execute');
  require('dotenv').config({ quiet: true });
  const token = process.env.NOTION_API_TOKEN || process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
  if (!token) throw new Error('Missing Notion API token: $NOTION_API_KEY');
  const interval = Number(process.env.RATE_LIMITING_INTERVAL || 350);
  if (!Number.isFinite(interval) || interval < 350) throw new Error('Invalid RATE_LIMITING_INTERVAL');
  // The installed SDK exposes request(); no global API-version/dependency upgrade.
  const { Client } = require('@notionhq/client');
  const client = new Client({ auth: token, notionVersion: '2026-03-11', logger: () => {} });
  let requestQueue = Promise.resolve();
  let retryAfter = 0;
  const request = async (route, method = 'get', body, query) => {
    for (let attempt = 0; ; attempt++) {
      requestQueue = requestQueue.then(() => sleep(Math.max(interval, retryAfter - Date.now())));
      await requestQueue;
      try { return await client.request({ path: route, method, body, query }); }
      catch (error) {
        if (error.status !== 429 || attempt >= 4) throw error;
        retryAfter = Math.max(retryAfter, Date.now() + Math.max(1000, Number(error.headers?.get?.('retry-after') || 1) * 1000));
      }
    }
  };
  const directory = path.join(__dirname, '..', '.findings-state');
  const file = path.join(directory, 'journal.json');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  let state = {};
  try { state = JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid journal');
  const save = async value => {
    const handle = await fs.open(`${file}.tmp`, 'w', 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(`${file}.tmp`, file);
  };
  const counts = await migrate({ request, state, save,
    log: console.log,
    onError: (prefix, error) => {
      console.error(process.env.GITHUB_ACTIONS === 'true'
        ? `Activity failed (${error.code || error.status || 'validation'}); continuing with next activity`
        : `${prefix} Failed: ${error.message}; continuing with next activity`);
      process.exitCode = 1;
    },
  });
  console.log(JSON.stringify(counts));
}
module.exports = { migrate, pageId, extraSources };
if (require.main === module) main().catch(error => {
  console.error(`Migration failed (${error.code || error.status || (process.env.GITHUB_ACTIONS === 'true' ? 'validation' : error.message)}). On hosted runs, an interrupted move may require manual Activity repair; local journal retained.`);
  process.exitCode = 1;
});
