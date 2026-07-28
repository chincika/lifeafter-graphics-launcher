const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureRuntimeAssets } = require('./runtime-assets');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-runtime-assets-'));
try {
  const sourceDir = path.join(tempRoot, 'volatile');
  const targetDir = path.join(tempRoot, 'stable');
  fs.mkdirSync(sourceDir, { recursive: true });
  const payload = Buffer.from('verified runtime component');
  const digest = crypto.createHash('sha256').update(payload).digest('hex').toUpperCase();
  fs.writeFileSync(path.join(sourceDir, 'component.exe'), payload);

  const first = ensureRuntimeAssets({
    sourceDir,
    targetDir,
    assets: [{ name: 'component.exe', sha256: digest }]
  });
  assert.deepEqual(fs.readFileSync(first['component.exe']), payload);

  fs.rmSync(sourceDir, { recursive: true, force: true });
  assert.deepEqual(fs.readFileSync(first['component.exe']), payload);

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'component.exe'), payload);
  fs.writeFileSync(first['component.exe'], 'corrupt');
  ensureRuntimeAssets({
    sourceDir,
    targetDir,
    assets: [{ name: 'component.exe', sha256: digest }]
  });
  assert.deepEqual(fs.readFileSync(first['component.exe']), payload);

  assert.throws(() => ensureRuntimeAssets({
    sourceDir,
    targetDir: path.join(tempRoot, 'rejected'),
    assets: [{ name: 'component.exe', sha256: '0'.repeat(64) }]
  }), /完整性校验失败/);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

process.stdout.write('runtime asset tests passed\n');
