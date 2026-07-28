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
  const source = path.join(sourceDir, 'nested', 'component.bin');
  const payload = Buffer.from('verified runtime component');
  const digest = crypto.createHash('sha256').update(payload).digest('hex').toUpperCase();
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, payload);

  const prepared = ensureRuntimeAssets({
    sourceDir,
    targetDir,
    assets: [{ name: 'nested/component.bin', sha256: digest }]
  });
  assert.deepEqual(fs.readFileSync(prepared['nested/component.bin']), payload);

  fs.rmSync(sourceDir, { recursive: true, force: true });
  assert.deepEqual(fs.readFileSync(prepared['nested/component.bin']), payload);
  assert.throws(() => ensureRuntimeAssets({
    sourceDir: targetDir,
    targetDir: path.join(tempRoot, 'rejected'),
    assets: [{ name: '../escape.bin', sha256: digest }]
  }), /无效路径/);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

process.stdout.write('runtime asset tests passed\n');
