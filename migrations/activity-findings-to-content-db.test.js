const assert = require('node:assert/strict');
const { migrate, pageId } = require('./activity-findings-to-content-db');
const ACTIVITIES = 'e'.repeat(32), CONTENT = 'f'.repeat(32);
const env = { ACTIVITIES_DATA_SOURCE_ID: ACTIVITIES, CONTENT_DATA_SOURCE_ID: CONTENT };
const activity = 'a'.repeat(32), source = 'b'.repeat(32), child = 'c'.repeat(32), other = 'd'.repeat(32);
function fixture() {
  const state = {}, calls = [], logs = [];
  let parent = { page_id: source }, related = [], failUpdate = false, conflict = false;
  const request = async (route, method = 'get', body, query) => {
    calls.push({ route, method, body, query });
    if (route === `data_sources/${CONTENT}`) return { properties: { Activity: { type: 'relation', relation: { data_source_id: ACTIVITIES } } } };
    if (route === `data_sources/${ACTIVITIES}`) return { properties: { Name: { title: [{ plain_text: 'Startup' }] }, findings_url: { type: 'url' }, findings_synced_at: { type: 'date' } } };
    if (route.endsWith('/query')) return body.start_cursor ? { results: [], has_more: false } : { results: [{ id: activity, properties: { Name: { title: [{ plain_text: 'Startup' }] }, findings_url: { url: `https://app.notion.com/p/${source}` } } }], has_more: true, next_cursor: 'activities-2' };
    if (route === `pages/${source}`) return { parent: { page_id: activity } };
    if (route === `blocks/${source}/children`) return query.start_cursor ? { results: parent.page_id ? [{ id: child, type: 'child_page' }] : [], has_more: false } : { results: [{ id: other, type: 'link_to_page' }], has_more: true, next_cursor: 'children-2' };
    if (route.endsWith('/move')) {
      assert.deepEqual(state[child], { source, activity }, 'intent saved before move');
      assert.deepEqual(body.parent, { type: 'data_source_id', data_source_id: CONTENT });
      parent = { data_source_id: CONTENT };
      return { id: child };
    }
    if (route === `pages/${activity}` && method === 'patch') {
      assert.ok(body.properties.findings_synced_at.date.start);
      return {};
    }
    if (route === `pages/${child}` && method === 'patch') {
      if (failUpdate) throw new Error('simulated update failure');
      related = body.properties.Activity.relation;
      return {};
    }
    if (route === `pages/${child}`) return { parent, properties: { Activity: { relation: conflict ? [{ id: other }] : related } } };
    throw new Error(`Unexpected call: ${route}`);
  };
  return { env, state, calls, logs, log: line => logs.push(line), request, save: async value => assert.equal(value, state), fail: value => { failUpdate = value; }, conflict: () => { conflict = true; } };
}
(async () => {
  assert.equal(pageId(`https://app.notion.com/p/Startup-content-${source}?source=copy_link`), source);
  assert.throws(() => pageId(`https://evil.example/${source}`));
  assert.throws(() => pageId('https://app.notion.com/no-id'));
  const f = fixture();
  await assert.rejects(migrate({ ...f, env: {} }), /ACTIVITIES_DATA_SOURCE_ID/);
  assert.equal(f.calls.length, 0);
  assert.equal((await migrate(f)).pending, 1);
  assert.ok(f.logs.includes('[activity: Startup] Found 1 finding pages'));
  assert.ok(f.logs.includes('[activity: Startup] Done: would move 1, verified 0'));
  assert.equal(f.calls.filter(c => c.method === 'patch' || c.route.endsWith('/move')).length, 0);
  assert.equal(f.calls.filter(c => c.query?.start_cursor === 'children-2').length, 1);
  assert.deepEqual(f.state, {});
  assert.equal(f.calls.filter(c => c.route === `pages/${activity}` && c.method === 'patch').length, 0);
  f.fail(true);
  await assert.rejects(migrate({ ...f, mode: 'apply' }), /simulated/);
  assert.deepEqual(f.state[child], { source, activity });
  assert.equal(f.logs.at(-1), '[activity: Startup] Failed');
  f.fail(false);
  assert.equal((await migrate({ ...f, mode: 'apply' })).completed, 1);
  assert.equal(f.calls.filter(c => c.route.endsWith('/move')).length, 1, 'retry must not move twice');
  assert.equal((await migrate({ ...f, mode: 'verify' })).pending, 0);
  assert.equal((await migrate({ ...f, mode: 'apply' })).verified, 1);
  assert.ok(f.logs.includes('[activity: Startup] Found 0 finding pages'));
  assert.ok(f.logs.includes('[activity: Startup] Done: completed 0, remaining 0, verified 1'));
  f.conflict();
  await assert.rejects(migrate({ ...f, mode: 'apply' }), /conflicting Activity/);
  console.log('findings migration checks passed (pagination, dry-run, recovery, idempotency, conflicts)');
})().catch(error => { console.error(error); process.exitCode = 1; });
