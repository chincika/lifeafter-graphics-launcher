const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256File(filePath) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex')
    .toUpperCase();
}

function safeRelativePath(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') ||
      normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('运行组件清单包含无效路径');
  }
  return normalized;
}

function ensureRuntimeAssets({ sourceDir, targetDir, assets }) {
  if (!sourceDir || !targetDir || !Array.isArray(assets) || !assets.length) {
    throw new Error('运行组件准备参数无效');
  }
  const prepared = {};
  for (const asset of assets) {
    const name = safeRelativePath(asset?.name);
    const expectedDigest = String(asset?.sha256 || '').toUpperCase();
    if (!/^[A-F0-9]{64}$/.test(expectedDigest)) {
      throw new Error('运行组件清单包含无效摘要');
    }
    const source = path.join(sourceDir, ...name.split('/'));
    const target = path.join(targetDir, ...name.split('/'));
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
      fs.mkdirSync(path.dirname(target), { recursive: true });
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
