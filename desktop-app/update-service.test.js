const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const {
  UpdateService,
  cleanupUpdateCache,
  digestFromText,
  isNewerVersion,
  schedulePortableReplacement,
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
    const checkService = new UpdateService({
      currentVersion: '2.3.0',
      repo: 'example/example',
      dataDir: tempRoot,
      fetchImpl: async url => {
        if (String(url).includes('/releases/latest')) {
          return new Response(JSON.stringify({
            tag_name: 'v2.3.1',
            html_url: 'https://example.invalid/releases/v2.3.1',
            assets: [{
              name: 'LifeAfter-Graphics-Launcher-2.3.1.exe',
              browser_download_url: 'https://example.invalid/update.exe',
              size: payload.length,
              digest: `sha256:${digest}`
            }]
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
        throw new Error(`unexpected request: ${url}`);
      }
    });
    const checked = await checkService.check();
    assert.equal(checked.ok, true);
    assert.equal(checked.updateAvailable, true);
    assert.equal(checked.expectedDigest, digest.toUpperCase());

    let downloadRequests = 0;
    const service = new UpdateService({
      currentVersion: '2.2.0',
      repo: 'example/example',
      dataDir: tempRoot,
      fetchImpl: async () => {
        downloadRequests += 1;
        return new Response(payload, {
          status: 200,
          headers: { 'content-length': String(payload.length) }
        });
      }
    });
    const downloaded = await service.download({
      name: 'LifeAfter-Graphics-Launcher-2.3.0.exe',
      browser_download_url: 'https://example.invalid/update.exe',
      size: payload.length
    }, digest, '2.3.0');
    assert.equal(downloaded.ok, true);
    assert.deepEqual(fs.readFileSync(downloaded.path), payload);
    assert.equal(service.publicState().phase, 'downloaded');
    assert.equal(downloadRequests, 1);

    const reused = await service.download({
      name: 'LifeAfter-Graphics-Launcher-2.3.0.exe',
      browser_download_url: 'https://example.invalid/update.exe',
      size: payload.length
    }, digest, '2.3.0');
    assert.equal(reused.ok, true);
    assert.equal(reused.reused, true);
    assert.equal(downloadRequests, 1);

    const rejected = await service.download({
      name: 'LifeAfter-Graphics-Launcher-2.3.1.exe',
      browser_download_url: 'https://example.invalid/update.exe',
      size: payload.length
    }, '0'.repeat(64), '2.3.1');
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /SHA-256/);

    const cacheRoot = path.join(tempRoot, 'cache-cleanup');
    const cacheUpdates = path.join(cacheRoot, 'updates');
    fs.mkdirSync(path.join(cacheUpdates, 'v2.3.0'), { recursive: true });
    fs.mkdirSync(path.join(cacheUpdates, 'v2.3.1'), { recursive: true });
    fs.mkdirSync(path.join(cacheUpdates, 'v2.3.2'), { recursive: true });
    fs.writeFileSync(path.join(cacheUpdates, 'v2.3.0', 'old.exe'), 'old');
    fs.writeFileSync(path.join(cacheUpdates, 'v2.3.1', 'current.exe'), 'current');
    fs.writeFileSync(path.join(cacheUpdates, 'v2.3.2', 'future.exe'), 'future');
    const staleScript = path.join(cacheUpdates, 'apply-update-100.ps1');
    const recentScript = path.join(cacheUpdates, 'apply-update-200.ps1');
    fs.writeFileSync(staleScript, '# stale');
    fs.writeFileSync(recentScript, '# recent');
    const now = Date.now();
    fs.utimesSync(staleScript, new Date(now - 10 * 60 * 1000), new Date(now - 10 * 60 * 1000));
    cleanupUpdateCache(cacheRoot, '2.3.1', now);
    assert.equal(fs.existsSync(path.join(cacheUpdates, 'v2.3.0')), false);
    assert.equal(fs.existsSync(path.join(cacheUpdates, 'v2.3.1')), false);
    assert.equal(fs.existsSync(path.join(cacheUpdates, 'v2.3.2')), true);
    assert.equal(fs.existsSync(staleScript), false);
    assert.equal(fs.existsSync(recentScript), true);

    if (process.platform === 'win32') {
      const installRoot = path.join(tempRoot, 'replacement');
      fs.mkdirSync(installRoot, { recursive: true });
      const target = path.join(installRoot, 'current.exe');
      const source = path.join(installRoot, 'downloaded.exe');
      fs.copyFileSync(path.join(process.env.WINDIR, 'System32', 'where.exe'), target);
      fs.copyFileSync(path.join(process.env.WINDIR, 'System32', 'whoami.exe'), source);
      const sourceDigest = crypto.createHash('sha256')
        .update(fs.readFileSync(source))
        .digest('hex')
        .toUpperCase();
      fs.writeFileSync(path.join(installRoot, 'apply-update-stale.ps1'), '# stale');
      let invocation = null;
      const scheduled = schedulePortableReplacement({
        downloadedPath: source,
        expectedDigest: sourceDigest,
        portablePath: target,
        currentPid: 999999,
        scriptDir: installRoot,
        spawnImpl(command, args, options) {
          invocation = { command, args, options };
          return { unref() {} };
        }
      });
      assert.equal(scheduled.ok, true);
      assert.ok(invocation);

      const marker = path.join(installRoot, 'locked.txt');
      const quote = value => String(value).replaceAll("'", "''");
      const lockScript = [
        `$stream=[System.IO.File]::Open('${quote(target)}','Open','Read','None')`,
        `Set-Content -LiteralPath '${quote(marker)}' -Value ready`,
        'Start-Sleep -Seconds 4',
        '$stream.Dispose()'
      ].join(';');
      const locker = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command', lockScript
      ], { windowsHide: true, stdio: 'ignore' });
      const markerDeadline = Date.now() + 5000;
      while (!fs.existsSync(marker) && Date.now() < markerDeadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(fs.existsSync(marker), true);

      const startedAt = Date.now();
      const installed = spawnSync(invocation.command, invocation.args, {
        ...invocation.options,
        detached: false,
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: 30000
      });
      assert.equal(installed.status, 0, installed.stderr || installed.stdout);
      assert.ok(Date.now() - startedAt >= 2500);
      assert.equal(
        crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex').toUpperCase(),
        sourceDigest
      );
      assert.equal(JSON.parse(fs.readFileSync(scheduled.resultPath, 'utf8')).success, true);
      assert.equal(fs.existsSync(scheduled.logPath), true);
      assert.equal(fs.existsSync(source), false);
      assert.deepEqual(
        fs.readdirSync(installRoot).filter(name => /^apply-update-.*\.ps1$/i.test(name)),
        []
      );
      await new Promise(resolve => locker.once('exit', resolve));

      const rollbackRoot = path.join(tempRoot, 'rollback');
      fs.mkdirSync(rollbackRoot, { recursive: true });
      const rollbackTarget = path.join(rollbackRoot, 'current.exe');
      const invalidSource = path.join(rollbackRoot, 'downloaded.exe');
      fs.copyFileSync(path.join(process.env.WINDIR, 'System32', 'where.exe'), rollbackTarget);
      const originalDigest = crypto.createHash('sha256')
        .update(fs.readFileSync(rollbackTarget))
        .digest('hex')
        .toUpperCase();
      fs.writeFileSync(invalidSource, 'not a Windows executable');
      const invalidDigest = crypto.createHash('sha256')
        .update(fs.readFileSync(invalidSource))
        .digest('hex')
        .toUpperCase();
      let rollbackInvocation = null;
      const rollbackScheduled = schedulePortableReplacement({
        downloadedPath: invalidSource,
        expectedDigest: invalidDigest,
        portablePath: rollbackTarget,
        currentPid: 999999,
        scriptDir: rollbackRoot,
        spawnImpl(command, args, options) {
          rollbackInvocation = { command, args, options };
          return { unref() {} };
        }
      });
      const rolledBack = spawnSync(rollbackInvocation.command, rollbackInvocation.args, {
        ...rollbackInvocation.options,
        detached: false,
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: 30000
      });
      assert.notEqual(rolledBack.status, 0);
      assert.equal(
        crypto.createHash('sha256')
          .update(fs.readFileSync(rollbackTarget))
          .digest('hex')
          .toUpperCase(),
        originalDigest
      );
      assert.equal(
        JSON.parse(fs.readFileSync(rollbackScheduled.resultPath, 'utf8')).success,
        false
      );
      assert.equal(fs.existsSync(invalidSource), true);
      assert.equal(fs.existsSync(rollbackScheduled.scriptPath), false);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  process.stdout.write('update-service tests passed\n');
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
