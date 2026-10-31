const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startRequiredChecks } = require('./startup-checks');

(async () => {
  for (const frequency of ['startup', 'daily', 'weekly', 'monthly']) {
    const calls = []; let tick;
    let finishNotice;
    const slowNotice = new Promise(resolve => { finishNotice = resolve; });
    const started = startRequiredChecks({
      showCached: () => calls.push('cached'),
      checkNotices: () => { calls.push('notices'); return slowNotice; },
      checkUpdates: notice => { calls.push('updates'); assert.equal(notice, started.noticeCheck); },
      pollPolicy: () => calls.push('poll'),
      getSettings: () => ({ updateFrequency: frequency, lastUpdateCheckAt: Date.now() }),
      shouldCheck: () => false,
      intervalMs: 60000,
      schedule: (callback, interval) => { assert.equal(interval, 60000); tick = callback; return {}; }
    });
    await started.updateCheck;
    assert.deepEqual(calls, ['cached', 'notices', 'updates'], `${frequency} must check both on every launch`);
    finishNotice(); await started.noticeCheck;
    tick(); await Promise.resolve();
    assert.equal(calls.at(-1), 'poll');
  }
  // Keep the production startup and packaging wiring covered by the release test.
  const main = fs.readFileSync(require.resolve('./main.js'), 'utf8');
  const pkg = require('./package.json');
  assert.match(main, /startRequiredChecks\(\{/);
  assert.match(main, /checkNotices:\s*refreshNotices/);
  assert.match(main, /checkUpdates:\s*noticeCheck\s*=>/);
  assert.ok(pkg.build.files.includes('startup-checks.js'));
  assert.match(pkg.scripts.preportable, /npm test/);
  console.log('mandatory startup checks tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
