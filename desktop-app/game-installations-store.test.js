const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  GameInstallationsStore,
  inspectInstallation,
  sameRoot
} = require('./game-installations-store');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeafter-installations-'));
const oldRoot = path.join(temp, 'LifeAfter');
const feverRoot = path.join(temp, 'OtherPublisher', 'mrzh');

function makeRoot(root, executable) {
  fs.mkdirSync(path.join(root, 'Documents', 'configs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Documents', 'bin', 'x64-3'), { recursive: true });
  fs.writeFileSync(path.join(root, executable), '');
  fs.writeFileSync(path.join(root, 'Documents', 'configs', 'pcconfig'), '{}');
  fs.writeFileSync(path.join(root, 'Documents', 'configs', 'qualityconfig'), '{}');
  fs.writeFileSync(path.join(root, 'Documents', 'configs', 'release_version_config'), '20260725');
  fs.writeFileSync(path.join(root, 'Documents', 'bin', 'x64-3', 'lifeafter.exe'), '');
}

makeRoot(oldRoot, 'lifeafter.exe');
makeRoot(feverRoot, 'mingrizhihou.exe');
fs.writeFileSync(path.join(feverRoot, 'Documents', 'script.py314.lc.npk'), '');

const oldInfo = inspectInstallation(oldRoot);
assert.equal(oldInfo.valid, true);
assert.equal(oldInfo.platformId, 'netease');
assert.equal(oldInfo.platformLabel, '老PC包体');
assert.equal(oldInfo.version, '20260725');

const feverInfo = inspectInstallation(feverRoot);
assert.equal(feverInfo.valid, true);
assert.equal(feverInfo.platformId, 'fever');
assert.equal(feverInfo.platformLabel, '发烧平台包体');
assert.equal(feverInfo.hasFeverLauncher, false);
assert.equal(feverInfo.fpsAvailable, true);

const store = new GameInstallationsStore(path.join(temp, 'store.json'));
store.merge([oldInfo, feverInfo]);
store.setActive(oldRoot, 'manual');
assert.equal(store.list().length, 2);
assert.equal(store.list()[0].active, true);
assert.equal(store.list()[0].source, 'manual');
assert.equal(store.remove(oldRoot), false);
assert.equal(store.remove(feverRoot), true);
assert.equal(store.list().length, 1);
assert.equal(sameRoot(`${oldRoot}\\`, oldRoot), true);

fs.rmSync(temp, { recursive: true, force: true });
process.stdout.write('game-installations-store tests passed\n');
