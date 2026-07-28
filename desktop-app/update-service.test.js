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
  verifyReleaseManifest,
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

const signingKeys = crypto.generateKeyPairSync('ed25519');
const signedAsset = {
  name: 'LifeAfter-Graphics-Launcher-2.3.0.exe',
  size: 123
};
const signedRelease = { tag_name: 'v2.3.0' };
const manifestText = JSON.stringify({
  schema: 1,
  tag: 'v2.3.0',
  version: '2.3.0',
  asset: {
    name: signedAsset.name,
    size: signedAsset.size,
    sha256: 'B'.repeat(64)
  }
});
const manifestSignature = crypto.sign(
  null,
  Buffer.from(manifestText, 'utf8'),
  signingKeys.privateKey
).toString('base64');
assert.equal(
  verifyReleaseManifest({
    manifestText,
    signatureText: manifestSignature,
    publicKey: signingKeys.publicKey,
    release: signedRelease,
    asset: signedAsset
  }).digest,
  'B'.repeat(64)
);
assert.throws(() => verifyReleaseManifest({
  manifestText: manifestText.replace('2.3.0', '9.9.9'),
  signatureText: manifestSignature,
  publicKey: signingKeys.publicKey,
  release: signedRelease,
  asset: signedAsset
}), /签名校验失败/);

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
