const assert = require('node:assert/strict');
const { test } = require('node:test');
const { health } = require('./health');
test('health only authenticates and reads; failures propagate', async () => {
  const calls = [];
  const notion = {
    users: { me: async () => calls.push('me') },
    databases: {
      retrieve: async args => calls.push(['schema', args]),
      query: async args => calls.push(['query', args]),
    },
  };
  const env = { ACTIVITIES_DATABASE_ID: 'a'.repeat(32), CONTENT_DATABASE_ID: 'b'.repeat(32) };
  await assert.rejects(health(notion, () => {}, {}), /database ID/);
  assert.equal(calls.length, 0);
  await health(notion, () => {}, env);
  assert.equal(calls.length, 5);
  assert.equal(calls[0], 'me');
  for (const i of [2, 4]) assert.equal(calls[i][1].page_size, 1);
  notion.users.me = async () => { throw new Error('unauthorized'); };
  await assert.rejects(health(notion, () => {}, env), /unauthorized/);
  assert.equal(calls.length, 5);
});
