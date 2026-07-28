const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  UpdateService,
  digestFromText,
  isNewerVersion,
  selectPortableAsset,
  shouldCheckForUpdates,
  versionParts
} = require('./update-service');

assert.deepEqual(versionParts('v2.3.1-beta.2'), [2, 3, 1]);
assert.equal(isNewerVersion('v2.3.0', '2.2.9'), true);
assert.equal(isNewerVersion('2.2.0', 'v2.2.0'), false);
assert.equal(isNewerVersion('2.1.9', '2.2.0'), false);
assert.equal(shouldCheckForUpdates('startup', Date.now()), true);
assert.equal(shouldCheckForUpdates('daily', Date.now() - 23 * 60 * 60 * 1000), false);
assert.equal(shouldCheckForUpdates('monthly', Date.now() - 31 * 24 * 60 * 60 * 1000), true);

const release = {
  tag_name: 'v2.3.0',
  assets: [
    { name: 'notes.txt' },
    { name: 'LifeAfter-Graphics-Launcher-2.3.0.exe' }
  ]
};
assert.equal(
  selectPortableAsset(release).name,
  'LifeAfter-Graphics-Launcher-2.3.0.exe'
);
assert.equal(
  digestFromText(
    `${'A'.repeat(64)}  LifeAfter-Graphics-Launcher-2.3.0.exe`,
    'LifeAfter-Graphics-Launcher-2.3.0.exe'
  ),
  'A'.repeat(64)
);

(async () => {
  const payload = Buffer.from('verified portable update payload', 'utf8');
  const digest = crypto.createHash('sha256').update(payload).digest('hex');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-update-test-'));
  try {
    const service = new UpdateService({
      currentVersion: '2.2.0',
      repo: 'example/example',
      dataDir: tempRoot,
      fetchImpl: async () => new Response(payload, {
        status: 200,
        headers: { 'content-length': String(payload.length) }
      })
    });
    const downloaded = await service.download({
      name: 'LifeAfter-Graphics-Launcher-2.3.0.exe',
      browser_download_url: 'https://example.invalid/update.exe',
      size: payload.length
    }, digest, '2.3.0');
    assert.equal(downloaded.ok, true);
    assert.deepEqual(fs.readFileSync(downloaded.path), payload);
    assert.equal(service.publicState().phase, 'downloaded');

    const rejected = await service.download({
      name: 'LifeAfter-Graphics-Launcher-2.3.1.exe',
      browser_download_url: 'https://example.invalid/update.exe',
      size: payload.length
    }, '0'.repeat(64), '2.3.1');
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /SHA-256/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  process.stdout.write('update-service tests passed\n');
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
