// Verify the actual unpacked Electron build, including every backend asset.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const desktop = path.join(repo, 'desktop-app');
const asar = require(require.resolve('@electron/asar', { paths: [desktop] }));
const unpacked = path.resolve(process.argv[2]);
const archive = path.join(unpacked, 'resources', 'app.asar');
const hash = data => crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
const sourceFiles = ['main.js', 'preload.js', 'startup-checks.js', 'remote-notices.js', 'update-service.js', 'renderer/index.html', 'renderer/app.js', 'renderer/styles.css', 'renderer/fluent.css'];
for (const name of sourceFiles) {
  assert.equal(hash(asar.extractFile(archive, name)), hash(fs.readFileSync(path.join(desktop, name))), `${name} differs`);
}
const manifest = JSON.parse(asar.extractFile(archive, 'runtime-assets-manifest.json').toString('utf8'));
for (const asset of manifest.assets) {
  const safe = asset.name.replaceAll('\\', '/').split('/');
  assert(safe.every(part => part && part !== '.' && part !== '..'));
  assert.equal(hash(fs.readFileSync(path.join(unpacked, 'resources', 'backend', ...safe))), asset.sha256.toUpperCase(), asset.name);
}
console.log(JSON.stringify({ status: 'passed', sourceFiles: sourceFiles.length, backendAssets: manifest.assets.length, backendSha256: manifest.assets.find(a => a.name === 'LifeAfterBackend.exe').sha256 }));
