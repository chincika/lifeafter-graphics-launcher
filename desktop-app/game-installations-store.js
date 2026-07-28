const fs = require('node:fs');
const path = require('node:path');

const TARGET_NAMES = new Set(['lifeafter', 'mrzh']);
const SKIP_NAMES = new Set([
  '$recycle.bin',
  'system volume information',
  'windows',
  'windows.old',
  'recovery',
  'programdata',
  'appdata',
  'node_modules',
  '.git'
]);

function normalizeRoot(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  const resolved = path.resolve(input);
  return resolved.replace(/[\\/]+$/, match => resolved.length <= 3 ? match[0] : '');
}

function sameRoot(left, right) {
  if (!left || !right) return false;
  return normalizeRoot(left).toLocaleLowerCase('en-US') ===
    normalizeRoot(right).toLocaleLowerCase('en-US');
}

function fileExists(root, ...parts) {
  try {
    return fs.statSync(path.join(root, ...parts)).isFile();
  } catch {
    return false;
  }
}

function readVersion(root) {
  try {
    const value = fs.readFileSync(
      path.join(root, 'Documents', 'configs', 'release_version_config'),
      'utf8'
    ).trim();
    return value.slice(0, 40) || '未知';
  } catch {
    return '未知';
  }
}

function inspectInstallation(value) {
  const root = normalizeRoot(value);
  const folderName = path.basename(root).toLocaleLowerCase('en-US');
  const hasLifeAfter = fileExists(root, 'lifeafter.exe');
  const hasMrzh = fileExists(root, 'mingrizhihou.exe');
  const hasFeverLauncher = fileExists(root, 'FeverGamesLauncher.exe');
  const hasConfigs =
    fileExists(root, 'Documents', 'configs', 'pcconfig') &&
    fileExists(root, 'Documents', 'configs', 'qualityconfig');
  const fever = hasMrzh && (folderName === 'mrzh' || hasFeverLauncher || !hasLifeAfter);
  const standardAvailable = fever ? hasMrzh : hasLifeAfter;
  const valid = Boolean(standardAvailable && hasConfigs);
  const platformId = fever ? 'fever' : 'netease';

  return {
    root,
    valid,
    platformId,
    platformLabel: fever ? '发烧平台包体' : '老PC包体',
    folderHint: folderName === 'mrzh'
      ? '文件夹 mrzh'
      : folderName === 'lifeafter'
        ? '文件夹 LifeAfter'
        : '文件特征',
    version: valid ? readVersion(root) : '未知',
    standardAvailable,
    performanceAvailable: fileExists(root, 'Documents', 'bin', 'x64-3', 'lifeafter.exe'),
    fpsAvailable:
      fileExists(root, 'Documents', 'script.py314.lc.npk') ||
      (fever && fileExists(root, 'script.py314.lc.npk')),
    hasFeverLauncher
  };
}

function fixedDriveRoots() {
  const roots = [];
  for (let code = 67; code <= 90; code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    try {
      if (fs.statSync(root).isDirectory()) roots.push(root);
    } catch {
    }
  }
  return roots;
}

function commonCandidates(driveRoot) {
  return [
    'LifeAfter',
    'mrzh',
    path.join('Games', 'LifeAfter'),
    path.join('Games', 'mrzh'),
    path.join('Game', 'LifeAfter'),
    path.join('Game', 'mrzh'),
    path.join('FeverGames', 'mrzh'),
    path.join('Netease', 'LifeAfter'),
    path.join('NetEase', 'LifeAfter'),
    path.join('Program Files', 'LifeAfter'),
    path.join('Program Files (x86)', 'LifeAfter')
  ].map(item => path.join(driveRoot, item));
}

function discoverInstallations({ knownRoots = [], maxDepth = 2 } = {}) {
  const found = new Map();
  const checked = new Set();

  const inspect = candidate => {
    let info;
    try {
      info = inspectInstallation(candidate);
    } catch {
      return;
    }
    const key = info.root.toLocaleLowerCase('en-US');
    if (checked.has(key)) return;
    checked.add(key);
    if (info.valid) found.set(key, info);
  };

  for (const root of knownRoots) {
    if (root) inspect(root);
  }

  const drives = fixedDriveRoots();
  for (const drive of drives) {
    for (const candidate of commonCandidates(drive)) inspect(candidate);
  }

  for (const drive of drives) {
    const queue = [{ root: drive, depth: 0 }];
    let visited = 0;
    while (queue.length && visited < 12000) {
      const current = queue.shift();
      visited += 1;
      let entries;
      try {
        entries = fs.readdirSync(current.root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const name = entry.name.toLocaleLowerCase('en-US');
        const child = path.join(current.root, entry.name);
        if (TARGET_NAMES.has(name)) {
          inspect(child);
          continue;
        }
        if (current.depth + 1 < maxDepth && !SKIP_NAMES.has(name) && !name.startsWith('$')) {
          queue.push({ root: child, depth: current.depth + 1 });
        }
      }
    }
  }

  return {
    drives,
    checkedCount: checked.size,
    installations: [...found.values()]
  };
}

class GameInstallationsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { activeRoot: '', installations: [] };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.data.activeRoot = String(parsed.activeRoot || '');
      this.data.installations = Array.isArray(parsed.installations)
        ? parsed.installations
          .filter(item => item && item.root)
          .map(item => ({
            root: normalizeRoot(item.root),
            source: item.source === 'manual' ? 'manual' : 'auto',
            addedAt: Number(item.addedAt) || Date.now(),
            lastUsedAt: Number(item.lastUsedAt) || 0
          }))
        : [];
    } catch {
      this.data = { activeRoot: '', installations: [] };
    }
    return this.list();
  }

  upsert(root, source = 'auto') {
    const normalized = normalizeRoot(root);
    let record = this.data.installations.find(item => sameRoot(item.root, normalized));
    if (!record) {
      record = {
        root: normalized,
        source: source === 'manual' ? 'manual' : 'auto',
        addedAt: Date.now(),
        lastUsedAt: 0
      };
      this.data.installations.push(record);
    } else if (source === 'manual') {
      record.source = 'manual';
    }
    return record;
  }

  merge(found) {
    for (const item of found || []) this.upsert(item.root, 'auto');
    this.save();
    return this.list();
  }

  setActive(root, source = 'manual') {
    const record = this.upsert(root, source);
    record.lastUsedAt = Date.now();
    this.data.activeRoot = record.root;
    this.save();
    return this.list();
  }

  remove(root) {
    if (sameRoot(root, this.data.activeRoot)) return false;
    const before = this.data.installations.length;
    this.data.installations = this.data.installations.filter(item => !sameRoot(item.root, root));
    if (before === this.data.installations.length) return false;
    this.save();
    return true;
  }

  list() {
    const activeRoot = this.data.activeRoot;
    return this.data.installations
      .map(record => ({
        ...inspectInstallation(record.root),
        source: record.source,
        sourceLabel: record.source === 'manual' ? '手动添加' : '自动发现',
        addedAt: record.addedAt,
        lastUsedAt: record.lastUsedAt,
        active: sameRoot(record.root, activeRoot)
      }))
      .sort((left, right) => {
        if (left.active !== right.active) return left.active ? -1 : 1;
        if (left.valid !== right.valid) return left.valid ? -1 : 1;
        return right.lastUsedAt - left.lastUsedAt || left.root.localeCompare(right.root);
      });
  }

  snapshot(scan = null) {
    return {
      activeRoot: this.data.activeRoot,
      installations: this.list(),
      scan: scan || null
    };
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({
      version: 1,
      activeRoot: this.data.activeRoot,
      installations: this.data.installations,
      updatedAt: Date.now()
    }, null, 2), 'utf8');
    try {
      fs.renameSync(temp, this.filePath);
    } catch {
      fs.copyFileSync(temp, this.filePath);
      fs.unlinkSync(temp);
    }
  }
}

module.exports = {
  GameInstallationsStore,
  discoverInstallations,
  inspectInstallation,
  normalizeRoot,
  sameRoot
};
