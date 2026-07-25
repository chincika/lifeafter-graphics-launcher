const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { HistoryStore } = require('./history-store');

const execFileAsync = promisify(execFile);
const cpuHistory = new Map();
let historyStore = null;

function backendDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, 'backend');
}

function backendPath() {
  return path.join(backendDir(), 'LifeAfterBackend.exe');
}

function savedRootPath() {
  return path.join(backendDir(), 'LifeAfterLauncher.path');
}

function persistentRootPath() {
  return path.join(app.getPath('userData'), 'game-root.txt');
}

function readSavedRoot() {
  try {
    const persistent = fs.readFileSync(persistentRootPath(), 'utf8').trim();
    if (persistent) return persistent;
  } catch {
  }
  try {
    return fs.readFileSync(savedRootPath(), 'utf8').trim();
  } catch {
    return '';
  }
}

async function runBackend(args, timeout = 30000) {
  try {
    const { stdout, stderr } = await execFileAsync(backendPath(), args, {
      windowsHide: true,
      timeout,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 4
    });
    return { ok: true, text: (stdout || '').trim(), stderr: (stderr || '').trim() };
  } catch (error) {
    const detail = [
      error.stdout,
      error.stderr,
      error.message
    ].filter(Boolean).join('\n').trim();
    return { ok: false, error: detail || '后台操作失败' };
  }
}

function computeCpu(payload) {
  const capturedAt = Number(payload.capturedAt) || Date.now();
  const active = new Set();
  const cpuCount = Math.max(1, os.cpus().length);
  for (const item of payload.instances || []) {
    active.add(item.pid);
    const previous = cpuHistory.get(item.pid);
    let cpu = 0;
    if (previous) {
      const elapsed = capturedAt - previous.capturedAt;
      const used = Number(item.totalCpuMs) - previous.totalCpuMs;
      if (elapsed > 0 && used >= 0) {
        cpu = Math.min(100, Math.max(0, used / elapsed / cpuCount * 100));
      }
    }
    item.cpuPercent = cpu;
    cpuHistory.set(item.pid, {
      totalCpuMs: Number(item.totalCpuMs) || 0,
      capturedAt
    });
  }
  for (const pid of cpuHistory.keys()) {
    if (!active.has(pid)) cpuHistory.delete(pid);
  }
  return payload;
}

async function getInstances() {
  const result = await runBackend(['--instances-json'], 10000);
  if (!result.ok) return result;
  try {
    const data = computeCpu(JSON.parse(result.text));
    historyStore?.syncInstances(data.instances, Number(data.capturedAt) || Date.now());
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: `实例数据解析失败：${error.message}` };
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: '#0b151d',
    backgroundMaterial: 'mica',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0b151d',
      symbolColor: '#d8e4e8',
      height: 52
    },
    icon: path.join(__dirname, 'renderer', 'assets', 'app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
}

ipcMain.handle('launcher:init', async () => {
  const persistedRoot = readSavedRoot();
  if (persistedRoot) {
    await runBackend(['--set-root', persistedRoot], 10000);
  }
  const [rootResult, summary, instances] = await Promise.all([
    runBackend(['--get-root'], 10000),
    runBackend(['--read-summary'], 10000),
    getInstances()
  ]);
  const detectedRoot = rootResult.ok ? rootResult.text : persistedRoot;
  if (detectedRoot) {
    fs.mkdirSync(path.dirname(persistentRootPath()), { recursive: true });
    fs.writeFileSync(persistentRootPath(), detectedRoot, 'utf8');
  }
  return {
    ok: true,
    root: detectedRoot,
    summary: summary.ok ? summary.text : '未找到游戏目录',
    instances: instances.ok ? instances.data : { instances: [] }
  };
});

ipcMain.handle('launcher:choose-root', async () => {
  const selected = await dialog.showOpenDialog({
    title: '选择 LifeAfter 游戏安装目录',
    properties: ['openDirectory']
  });
  if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true };
  const result = await runBackend(['--set-root', selected.filePaths[0]]);
  if (result.ok) {
    fs.mkdirSync(path.dirname(persistentRootPath()), { recursive: true });
    fs.writeFileSync(persistentRootPath(), result.text, 'utf8');
    return { ok: true, root: result.text };
  }
  return result;
});

ipcMain.handle('launcher:apply-preset', async (_event, payload) => {
  const args = ['--apply', String(payload.preset || '')];
  if (payload.launch) args.push('--launch');
  return runBackend(args, 60000);
});

ipcMain.handle('launcher:read-summary', () => runBackend(['--read-summary'], 10000));
ipcMain.handle('launcher:get-instances', () => getInstances());
ipcMain.handle('launcher:restore-latest', () => runBackend(['--restore-latest'], 20000));
ipcMain.handle('launcher:restore-factory', () => runBackend(['--restore-factory'], 20000));
ipcMain.handle('launcher:clean-backups', () => runBackend(['--clean-backups'], 20000));
ipcMain.handle('launcher:set-tiaozi', (_event, scale) =>
  runBackend(['--set-tiaozi', String(scale)], 20000));

ipcMain.handle('launcher:open-backups', async () => {
  const root = readSavedRoot();
  if (!root) return { ok: false, error: '请先选择游戏目录' };
  const target = path.join(root, 'Documents', 'configs', 'profile_backups');
  fs.mkdirSync(target, { recursive: true });
  const error = await shell.openPath(target);
  return error ? { ok: false, error } : { ok: true };
});

ipcMain.handle('launcher:open-log', async () => {
  const root = readSavedRoot();
  if (!root) return { ok: false, error: '请先选择游戏目录' };
  const target = path.join(root, 'Documents', 'configs', 'launcher_data', 'LifeAfterLauncher.log');
  if (!fs.existsSync(target)) return { ok: false, error: '日志文件尚未生成' };
  const error = await shell.openPath(target);
  return error ? { ok: false, error } : { ok: true };
});

ipcMain.handle('launcher:get-history', (_event, range) => {
  if (!historyStore) return { ok: false, error: '启动记录尚未就绪' };
  return { ok: true, data: historyStore.aggregate(range) };
});

ipcMain.handle('launcher:export-history', async (_event, range) => {
  if (!historyStore) return { ok: false, error: '启动记录尚未就绪' };
  const labels = { day: '日', week: '周', month: '月', total: '总' };
  const date = new Date().toISOString().slice(0, 10);
  const selected = await dialog.showSaveDialog({
    title: '导出启动记录',
    defaultPath: `启动记录-${labels[range] || '总'}-${date}.csv`,
    filters: [{ name: 'CSV 表格', extensions: ['csv'] }]
  });
  if (selected.canceled || !selected.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(selected.filePath, historyStore.exportCsv(range), 'utf8');
  return { ok: true, path: selected.filePath };
});

ipcMain.handle('launcher:open-history-folder', async () => {
  if (!historyStore) return { ok: false, error: '启动记录尚未就绪' };
  fs.mkdirSync(historyStore.dataDir, { recursive: true });
  const error = await shell.openPath(historyStore.dataDir);
  return error ? { ok: false, error } : { ok: true };
});

app.whenReady().then(() => {
  historyStore = new HistoryStore(path.join(app.getPath('userData'), 'history'));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  historyStore?.syncInstances([], Date.now());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
