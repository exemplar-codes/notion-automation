const assert = require('node:assert/strict');
const { migrate, pageId } = require('./activity-findings-to-content-db');
const ACTIVITIES = 'e'.repeat(32), CONTENT = 'f'.repeat(32);
const env = { ACTIVITIES_DATA_SOURCE_ID: ACTIVITIES, CONTENT_DATA_SOURCE_ID: CONTENT };
const activity = 'a'.repeat(32), source = 'b'.repeat(32), child = 'c'.repeat(32), other = 'd'.repeat(32);
function fixture() {
  const state = {}, calls = [], logs = [];
  let tags = [{ name: 'existing' }];
  let parent = { page_id: source }, related = [], failUpdate = false, conflict = false;
  const request = async (route, method = 'get', body, query) => {
    calls.push({ route, method, body, query });
    if (route === `data_sources/${CONTENT}`) return { properties: { Tags: { type: 'multi_select' }, Activity: { type: 'relation', relation: { data_source_id: ACTIVITIES } } } };
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
      tags = body.properties.Tags.multi_select;
      assert.deepEqual(tags, [{ name: 'existing' }, { name: 'migration' }]);
      return {};
    }
    if (route === `pages/${child}`) return { parent, properties: { Tags: { multi_select: tags }, Activity: { relation: conflict ? [{ id: other }] : related } } };
    throw new Error(`Unexpected call: ${route}`);
  };
  return { env, state, calls, logs, log: line => logs.push(line), request, save: async value => assert.equal(value, state), fail: value => { failUpdate = value; }, conflict: () => { conflict = true; } };
}
(async () => {
  assert.equal(pageId(`https://app.notion.com/p/Startup-content-${source}?source=copy_link`), source);
  assert.throws(() => pageId(`https://evil.example/${source}`));
  assert.throws(() => pageId('https://app.notion.com/no-id'));
  for (const flag of ['archived', 'in_trash']) {
    for (const target of ['activity', 'source', 'child']) {
      const t = fixture();
      t.state[child] = { source, activity };
      const request = async (...args) => {
        const result = await t.request(...args);
        if (target === 'activity' && args[0].endsWith('/query')) {
          result.results.forEach(row => { row[flag] = true; });
        }
        if (args[0] === `pages/${target === 'source' ? source : child}` && target !== 'activity') result[flag] = true;
        return result;
      };
      assert.deepEqual(await migrate({ ...t, request, mode: 'apply' }), { pending: 0, completed: 0, verified: 0 });
      assert.equal(t.calls.filter(c => c.route.endsWith('/move') || (c.method === 'patch' && c.route !== `pages/${activity}`)).length, 0);
      if (target !== 'child') assert.equal(t.calls.filter(c => c.method === 'patch' || c.route.startsWith('blocks/')).length, 0);
    }
  }
  const mismatch = fixture();
  await migrate({ ...mismatch, request: (...args) => args[0] === `pages/${source}` ? { parent: { page_id: other } } : mismatch.request(...args) });
  assert.ok(mismatch.logs.some(line => line.includes('Failed: Content page is not a child')));
  const continuation = fixture();
  const nextActivity = 'd'.repeat(32), nextSource = '2'.repeat(32);
  continuation.fail(true);
  const continuationRequest = async (...args) => {
    if (args[0] === `pages/${nextSource}`) {
      assert.ok(continuation.calls.some(c => c.route.endsWith('/move')), 'move before scanning next activity');
      return { parent: { page_id: nextActivity } };
    }
    if (args[0] === `blocks/${nextSource}/children`) return { results: [], has_more: false };
    if (args[0] === `pages/${nextActivity}`) { continuation.calls.push({ route: args[0], method: args[1] }); return {}; }
    const result = await continuation.request(...args);
    if (args[0].endsWith('/query') && !args[2].start_cursor) result.results.push({ id: nextActivity, properties: { findings_url: { url: `https://notion.so/${nextSource}` } } });
    return result;
  };
  // The first activity must attempt its move before the next activity is scanned.
  await migrate({ ...continuation, request: continuationRequest, mode: 'apply' });
  assert.ok(continuation.calls.some(c => c.route === `pages/${nextActivity}` && c.method === 'patch'));
  assert.ok(!continuation.calls.some(c => c.route === `pages/${activity}` && c.method === 'patch'));
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
  await migrate({ ...f, mode: 'apply' });
  assert.deepEqual(f.state[child], { source, activity });
  assert.equal(f.logs.at(-1), '[activity: Startup] Failed: simulated update failure');
  f.fail(false);
  assert.equal((await migrate({ ...f, mode: 'apply' })).completed, 1);
  assert.equal(f.calls.filter(c => c.route.endsWith('/move')).length, 1, 'retry must not move twice');
  assert.equal((await migrate({ ...f, mode: 'verify' })).pending, 0);
  assert.equal((await migrate({ ...f, mode: 'apply' })).verified, 1);
  assert.ok(f.logs.includes('[activity: Startup] Found 0 finding pages'));
  assert.ok(f.logs.includes('[activity: Startup] Done: completed 0, remaining 0, verified 1'));
  assert.ok(f.logs.includes('[activity: Startup] Progress (apply): 1/1 handled, 0 left; completed 1, verified 0, skipped 0'));
  assert.ok(f.logs.includes('[activity: Startup] Progress (apply): 1/1 handled, 0 left; completed 0, verified 1, skipped 0'));
  const hosted = fixture();
  await migrate({ ...hosted, env: { ...env, GITHUB_ACTIONS: 'true' } });
  assert.ok(hosted.logs.some(line => line.includes('[activity: #1] Progress')));
  assert.ok(hosted.logs.every(line => !line.includes('Startup')));
  f.conflict();
  await migrate({ ...f, mode: 'apply' });
  assert.ok(f.logs.at(-1).includes('conflicting Activity'));
  console.log('findings migration checks passed (pagination, dry-run, recovery, idempotency, conflicts)');
})().catch(error => { console.error(error); process.exitCode = 1; });
