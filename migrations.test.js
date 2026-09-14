const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/migrations.js`, 'utf8');
function run(args, env = {}) {
  let dispatched;
  const process = { argv: ['node', 'migrations.js', ...args], env, execPath: 'node' };
  vm.runInNewContext(source, {
    __dirname, process, console: { log() {}, error() {} },
    require: name => name === 'dotenv' ? { config() {} } : name === 'node:child_process' ? {
      spawnSync: (...args) => { dispatched = args; return { status: 7 }; },
    } : require(name),
  });
  return { process, dispatched };
}
for (const args of [['run', '../setup'], ['run'], ['run', 'activity-findings-to-content-db']]) {
  const result = run(args);
  assert.equal(result.process.exitCode, 1);
  assert.equal(result.dispatched, undefined);
}
const result = run(['run', 'activity-findings-to-content-db', '--verbose'], {
  NOTION_API_KEY: 'test', ACTIVITIES_DATA_SOURCE_ID: 'a'.repeat(32), CONTENT_DATA_SOURCE_ID: 'b'.repeat(32),
});
assert.ok(result.dispatched[1][0].endsWith('/migrations/activity-findings-to-content-db.js'));
assert.equal(result.dispatched[1][1], '--verbose');
assert.equal(result.process.exitCode, 7);
console.log('Migration runner checks passed (name, env, arguments, exit status)');
