const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256File(filePath) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex')
    .toUpperCase();
}

function ensureRuntimeAssets({ sourceDir, targetDir, assets }) {
  if (!sourceDir || !targetDir || !Array.isArray(assets) || !assets.length) {
    throw new Error('运行组件准备参数无效');
  }
  fs.mkdirSync(targetDir, { recursive: true });
  const prepared = {};
  for (const asset of assets) {
    const name = path.basename(String(asset?.name || ''));
    const expectedDigest = String(asset?.sha256 || '').toUpperCase();
    if (!name || !/^[A-F0-9]{64}$/.test(expectedDigest)) {
      throw new Error('运行组件清单无效');
    }
    const source = path.join(sourceDir, name);
    const target = path.join(targetDir, name);
    if (!fs.statSync(source).isFile() || sha256File(source) !== expectedDigest) {
      throw new Error(`${name} 完整性校验失败`);
    }
    let targetReady = false;
    try {
      targetReady = fs.statSync(target).isFile() &&
        sha256File(target) === expectedDigest;
    } catch {
    }
    if (!targetReady) {
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
      try {
        fs.copyFileSync(source, temporary);
        if (sha256File(temporary) !== expectedDigest) {
          throw new Error(`${name} 稳定副本校验失败`);
        }
        fs.renameSync(temporary, target);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    }
    prepared[name] = target;
  }
  return prepared;
}

module.exports = { ensureRuntimeAssets, sha256File };
