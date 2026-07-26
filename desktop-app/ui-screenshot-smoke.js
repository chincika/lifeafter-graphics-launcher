const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const output = path.resolve(
  process.env.LAUNCHER_UI_SCREENSHOT || path.join(__dirname, 'ui-smoke-fps.png')
);

const fpsStatus = {
  ok: true,
  compatible: true,
  writable: true,
  gameRunning: false,
  state: 'conditional-180',
  stateLabel: '120 → 180 FPS',
  target: 180,
  packagePath: 'D:\\LifeAfter\\Documents\\script.py314.lc.npk',
  packageHash: 'UI-SMOKE-PACKAGE-HASH',
  normalizedHash: 'UI-SMOKE-NORMALIZED-HASH',
  slotHash: 'UI-SMOKE-SLOT-HASH',
  backupDir: 'D:\\LifeAfter\\Documents\\fps_unlock_backups',
  backupCount: 2,
  transactionBackupCount: 1,
  baselineReady: true,
  packageSize: 322688424
};

ipcMain.handle('launcher:init', async () => ({
  ok: true,
  root: 'D:\\LifeAfter',
  summary: '当前档位：2K 120',
  instances: { capturedAt: Date.now(), instances: [] },
  fpsTargetPreference: 180,
  fpsStatus
}));
ipcMain.handle('launcher:get-instances', async () => ({
  ok: true,
  data: { capturedAt: Date.now(), instances: [] }
}));
ipcMain.handle('launcher:get-fps-status', async () => ({ ok: true, data: fpsStatus }));
ipcMain.handle('launcher:save-fps-target', async () => ({ ok: true }));
ipcMain.handle('launcher:apply-fps', async () => {
  throw new Error('UI smoke simulated IPC failure');
});
ipcMain.handle('launcher:clean-fps-backups', async () => {
  fpsStatus.transactionBackupCount = 0;
  fpsStatus.backupCount = 1;
  return {
    ok: true,
    text: '已清理 1 份事务备份；官方初始还原点已永久保留。'
  };
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1920,
    height: 1230,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const ready = await win.webContents.executeJavaScript(
      "document.querySelector('#fpsCurrentState')?.textContent === '120 → 180 FPS'"
    );
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  await win.webContents.executeJavaScript(`(() => {
    document.querySelectorAll('.view').forEach(view => {
      view.style.animation = 'none';
    });
    switchView('fps');
  })()`);
  await new Promise(resolve => setTimeout(resolve, 250));

  const initial = await win.webContents.executeJavaScript(`(() => ({
    applyDisabled: document.querySelector('#applyFpsUnlock').disabled,
    restoreDisabled: document.querySelector('#restoreFpsUnlock').disabled,
    cleanDisabled: document.querySelector('#cleanFpsBackups').disabled
  }))()`);
  if (initial.applyDisabled || initial.restoreDisabled || initial.cleanDisabled) {
    throw new Error(`FPS actions did not start enabled: ${JSON.stringify(initial)}`);
  }

  const recovered = await win.webContents.executeJavaScript(`(async () => {
    const button = document.querySelector('#applyFpsUnlock');
    const operation = applySelectedFpsTarget(button);
    await new Promise(resolve => setTimeout(resolve, 20));
    document.querySelector('#confirmModal [data-result="confirm"]').click();
    await operation;
    return {
      applyDisabled: document.querySelector('#applyFpsUnlock').disabled,
      restoreDisabled: document.querySelector('#restoreFpsUnlock').disabled,
      loading: button.classList.contains('loading'),
      activity: document.querySelector('#activityMessage').textContent,
      modalHidden: document.querySelector('#confirmModal').hidden,
      activeView: document.querySelector('.view.active')?.id
    };
  })()`);
  if (
    recovered.applyDisabled ||
    recovered.restoreDisabled ||
    recovered.loading ||
    !recovered.modalHidden
  ) {
    throw new Error(`FPS actions stayed locked after IPC rejection: ${JSON.stringify(recovered)}`);
  }

  const cleaned = await win.webContents.executeJavaScript(`(async () => {
    const button = document.querySelector('#cleanFpsBackups');
    const operation = cleanFpsTransactionBackups(button);
    await new Promise(resolve => setTimeout(resolve, 20));
    document.querySelector('#confirmModal [data-result="confirm"]').click();
    await operation;
    return {
      cleanDisabled: button.disabled,
      backupText: document.querySelector('#fpsBackupCount').textContent,
      baselineText: document.querySelector('#fpsBaselineState').textContent
    };
  })()`);
  if (
    cleaned.cleanDisabled ||
    cleaned.backupText !== '0 份事务 + 1 份永久' ||
    !cleaned.baselineText.includes('永久保留')
  ) {
    throw new Error(`FPS backup cleanup UI mismatch: ${JSON.stringify(cleaned)}`);
  }

  await win.webContents.executeJavaScript("switchView('fps')");
  win.setPosition(-32000, -32000);
  win.showInactive();
  win.webContents.invalidate();
  await new Promise(resolve => setTimeout(resolve, 800));
  const visual = await win.webContents.executeJavaScript(`(() => {
    const view = document.querySelector('#fpsView');
    const layout = document.querySelector('.fps-layout');
    return {
      activeView: document.querySelector('.view.active')?.id,
      viewDisplay: getComputedStyle(view).display,
      viewOpacity: getComputedStyle(view).opacity,
      viewHeight: Math.round(view.getBoundingClientRect().height),
      layoutHeight: Math.round(layout.getBoundingClientRect().height)
    };
  })()`);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(output, image.toPNG());
  process.stdout.write(`${JSON.stringify({ initial, recovered, cleaned, visual, output }, null, 2)}\n`);
  app.quit();
}).catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
