const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const output = path.resolve(
  process.env.LAUNCHER_UI_SCREENSHOT || path.join(__dirname, 'ui-smoke-fps.png')
);
const performanceOutput = path.resolve(
  process.env.LAUNCHER_PERFORMANCE_UI_SCREENSHOT ||
    path.join(__dirname, 'ui-smoke-performance.png')
);
const packageOutput = path.resolve(
  process.env.LAUNCHER_PACKAGE_UI_SCREENSHOT ||
    path.join(__dirname, 'ui-smoke-packages.png')
);
const supportOutput = path.resolve(
  process.env.LAUNCHER_SUPPORT_UI_SCREENSHOT ||
    path.join(__dirname, 'ui-smoke-support.png')
);
const historyOutput = path.resolve(
  process.env.LAUNCHER_HISTORY_UI_SCREENSHOT ||
    path.join(__dirname, 'ui-smoke-history.png')
);
const schedulingOutput = path.resolve(
  process.env.LAUNCHER_SCHEDULING_UI_SCREENSHOT ||
    path.join(__dirname, 'ui-smoke-scheduling.png')
);

const processScheduling = {
  topology: {
    ok: true,
    model: '13th Gen Intel(R) Core(TM) i7-13700HX',
    physicalCoreCount: 16,
    logicalProcessorCount: 24,
    processorGroupCount: 1,
    heterogeneous: true,
    cpuSets: Array.from({ length: 24 }, (_, logicalProcessorIndex) => ({
      id: 256 + logicalProcessorIndex,
      group: 0,
      logicalProcessorIndex,
      coreIndex: logicalProcessorIndex < 16
        ? Math.floor(logicalProcessorIndex / 2) * 2
        : logicalProcessorIndex,
      efficiencyClass: logicalProcessorIndex < 16 ? 1 : 0,
      schedulingClass: logicalProcessorIndex < 16 ? 1 : 0,
      parked: false,
      coreType: logicalProcessorIndex < 16 ? 'performance' : 'efficiency'
    }))
  },
  policies: {
    '2K 120': { priority: 'high', cpuMode: 'all', cpuSetIds: [] },
    '1080p 120': { priority: 'high', cpuMode: 'all', cpuSetIds: [] },
    '1080p 60': { priority: 'normal', cpuMode: 'system', cpuSetIds: [] },
    '900p 120': { priority: 'high', cpuMode: 'all', cpuSetIds: [] },
    '900p 60': { priority: 'normal', cpuMode: 'system', cpuSetIds: [] },
    '720p 60': { priority: 'normal', cpuMode: 'system', cpuSetIds: [] },
    '540p 60': { priority: 'normal', cpuMode: 'system', cpuSetIds: [] },
    '540p 25': { priority: 'idle', cpuMode: 'efficiency', cpuSetIds: [] }
  }
};
const savedProcessPolicies = [];

const fpsStatus = {
  ok: true,
  compatible: true,
  writable: true,
  gameRunning: false,
  state: 'conditional-180',
  stateLabel: '120 → 180 FPS',
  target: 180,
  platformId: 'fever',
  platformLabel: '发烧平台包体',
  gameVersion: '20260724',
  compatibilityMode: 'known-profile',
  compatibilityLabel: '已验证档案',
  profileId: 'fever-BCACC8B1CFD4C4DB',
  knownProfile: true,
  packagePath: 'E:\\FeverGames\\mrzh\\Documents\\script.py314.lc.npk',
  packageHash: 'UI-SMOKE-PACKAGE-HASH',
  normalizedHash: 'UI-SMOKE-NORMALIZED-HASH',
  slotHash: 'UI-SMOKE-SLOT-HASH',
  rootPackagePath: 'E:\\FeverGames\\mrzh\\script.py314.lc.npk',
  rootPackagePresent: true,
  rootPackageReadOnly: true,
  rootPackageSize: 488582380,
  backupDir: 'E:\\FeverGames\\mrzh\\Documents\\fps_unlock_backups',
  protectedBackupDir: 'C:\\LauncherData\\protected-backups',
  backupCount: 2,
  transactionBackupCount: 1,
  baselineReady: true,
  packageSize: 97122752
};
let lastPresetPayload = null;
let savedPerformanceMode = true;
let historyEnabled = true;
let updateFrequency = 'startup';
const updateState = {
  phase: 'current',
    currentVersion: '2.4.1',
    latestVersion: '2.4.1',
  progress: 100,
    message: '当前已是最新版本 v2.4.1',
  releaseUrl: 'https://github.com/chincika/lifeafter-graphics-launcher/releases/tag/v2.2.0',
  downloadedPath: '',
  error: '',
  frequency: updateFrequency,
  lastCheckedAt: Date.now(),
  automaticInstallSupported: true
};
const installations = {
  activeRoot: 'D:\\Program Files (x86)\\LifeAfter',
  scan: {
    drives: ['C:\\', 'D:\\', 'E:\\'],
    checkedCount: 24,
    foundCount: 2,
    completedAt: Date.now()
  },
  installations: [
    {
      root: 'D:\\Program Files (x86)\\LifeAfter',
      valid: true,
      platformId: 'netease',
      platformLabel: '老PC包体',
      folderHint: '文件夹 LifeAfter',
      version: '20260724',
      performanceAvailable: true,
      fpsAvailable: true,
      sourceLabel: '手动添加',
      lastUsedAt: Date.now(),
      active: true
    },
    {
      root: 'E:\\FeverGames\\mrzh',
      valid: true,
      platformId: 'fever',
      platformLabel: '发烧平台包体',
      folderHint: '文件夹 mrzh',
      version: '20260724',
      performanceAvailable: true,
      fpsAvailable: true,
      sourceLabel: '自动发现',
      lastUsedAt: 0,
      active: false
    }
  ]
};

ipcMain.handle('launcher:init', async () => ({
  ok: true,
  root: 'D:\\LifeAfter',
  summary: '当前档位：2K 120',
  instances: { capturedAt: Date.now(), instances: [] },
  fpsTargetPreference: 180,
  performanceMode: true,
  launchMode: {
    standardAvailable: true,
    performanceAvailable: true,
    performanceRoute: 'Documents\\bin\\x64-3\\lifeafter.exe'
  },
  fpsStatus,
  installations,
  historyEnabled,
  update: updateState,
  processScheduling
}));
ipcMain.handle('launcher:choose-root', async () => ({ ok: false, canceled: true }));
ipcMain.handle('launcher:scan-roots', async () => ({ ok: true, data: installations }));
ipcMain.handle('launcher:switch-root', async () => ({ ok: false, error: 'UI smoke only' }));
ipcMain.handle('launcher:remove-root', async () => ({ ok: true, data: installations }));
ipcMain.handle('launcher:set-history-enabled', async (_event, enabled) => {
  historyEnabled = enabled === true;
  return { ok: true, value: historyEnabled };
});
ipcMain.handle('launcher:get-update-state', async () => ({
  ok: true,
  data: { ...updateState, frequency: updateFrequency }
}));
ipcMain.handle('launcher:set-update-frequency', async (_event, frequency) => {
  updateFrequency = frequency;
  return { ok: true, data: { ...updateState, frequency: updateFrequency } };
});
ipcMain.handle('launcher:check-for-updates', async () => ({
  ok: true,
  updateAvailable: false,
  data: { ...updateState, frequency: updateFrequency }
}));
ipcMain.handle('launcher:get-history', async (_event, range) => ({
  ok: true,
  data: {
    range,
    totalDurationMs: 0,
    launchCount: 0,
    averageDurationMs: 0,
    mostUsedAccount: '暂无',
    mostUsedShare: 0,
    durationDeltaMs: 0,
    launchDelta: 0,
    accounts: [],
    recent: []
  }
}));
ipcMain.handle('launcher:apply-preset', async (_event, payload) => {
  lastPresetPayload = payload;
  return { ok: true, text: '启动模式：性能优先' };
});
ipcMain.handle('launcher:set-performance-mode', async (_event, enabled) => {
  savedPerformanceMode = enabled === true;
  return { ok: true, value: savedPerformanceMode };
});
ipcMain.handle('launcher:get-process-scheduling', async () => ({
  ok: true,
  data: processScheduling
}));
ipcMain.handle('launcher:save-process-policy', async (_event, payload) => {
  processScheduling.policies[payload.preset] = payload.policy;
  savedProcessPolicies.push(JSON.parse(JSON.stringify(payload)));
  return { ok: true, preset: payload.preset, policy: payload.policy };
});
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
ipcMain.handle('launcher:open-fps-backups', async () => ({ ok: true }));
ipcMain.handle('launcher:open-fps-protected-backups', async () => ({ ok: true }));

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

  await win.webContents.executeJavaScript(
    "document.querySelectorAll('.view').forEach(view => { view.style.animation = 'none'; })"
  );
  win.setPosition(-32000, -32000);
  win.showInactive();
  win.webContents.invalidate();
  await new Promise(resolve => setTimeout(resolve, 500));
  const performanceImage = await win.webContents.capturePage();
  fs.writeFileSync(performanceOutput, performanceImage.toPNG());

  const highFrameSchedulingVisual = await win.webContents.executeJavaScript(`(() => {
    updatePreset('2K 120');
    openProcessScheduling();
    return {
      entry: document.querySelector('#schedulingSummary').textContent,
      selectedPriority: document.querySelector('#priorityOptions .active')?.dataset.priority,
      selectedMode: document.querySelector('#cpuModeOptions .active')?.dataset.cpuMode
    };
  })()`);
  if (
    !highFrameSchedulingVisual.entry.includes('全核心') ||
    highFrameSchedulingVisual.selectedPriority !== 'high' ||
    highFrameSchedulingVisual.selectedMode !== 'all'
  ) {
    throw new Error(`High frame scheduling UI mismatch: ${JSON.stringify(highFrameSchedulingVisual)}`);
  }

  const schedulingVisual = await win.webContents.executeJavaScript(`(() => {
    updatePreset('540p 25');
    openProcessScheduling();
    const drawer = document.querySelector('#processSchedulingDrawer');
    const entry = document.querySelector('#schedulingSummary');
    return {
      drawerVisible: !drawer.hidden,
      instancesHidden: document.querySelector('#instancesPanel').hidden,
      entry: entry.textContent,
      cpu: document.querySelector('#cpuModel').textContent,
      summary: document.querySelector('#cpuTopologySummary').textContent,
      selectedPriority: document.querySelector('#priorityOptions .active')?.dataset.priority,
      selectedMode: document.querySelector('#cpuModeOptions .active')?.dataset.cpuMode,
      topologyGroups: document.querySelectorAll('.topology-group').length
    };
  })()`);
  if (
    !schedulingVisual.drawerVisible ||
    !schedulingVisual.instancesHidden ||
    !schedulingVisual.entry.includes('低') ||
    schedulingVisual.selectedPriority !== 'idle' ||
    schedulingVisual.selectedMode !== 'efficiency' ||
    schedulingVisual.topologyGroups !== 2
  ) {
    throw new Error(`Process scheduling UI mismatch: ${JSON.stringify(schedulingVisual)}`);
  }

  const systemManagedVisual = await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('#cpuModeOptions [data-cpu-mode="system"]').click();
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && processSchedulingState.policies['540p 25'].cpuMode !== 'system') {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return {
      entry: document.querySelector('#schedulingSummary').textContent,
      selectedMode: document.querySelector('#cpuModeOptions .active')?.dataset.cpuMode,
      savedMode: processSchedulingState.policies['540p 25'].cpuMode
    };
  })()`);
  if (
    !systemManagedVisual.entry.includes('系统管理') ||
    systemManagedVisual.selectedMode !== 'system' ||
    systemManagedVisual.savedMode !== 'system' ||
    savedProcessPolicies.at(-1)?.policy?.cpuMode !== 'system'
  ) {
    throw new Error(`System managed scheduling save mismatch: ${JSON.stringify({
      systemManagedVisual,
      savedProcessPolicies
    })}`);
  }
  win.hide();
  win.setPosition(-32000, -32000);
  win.showInactive();
  win.webContents.invalidate();
  await new Promise(resolve => setTimeout(resolve, 700));
  const schedulingImage = await win.webContents.capturePage();
  fs.writeFileSync(schedulingOutput, schedulingImage.toPNG());
  await win.webContents.executeJavaScript('closeProcessScheduling()');

  const performance = await win.webContents.executeJavaScript(`(async () => {
    const checkbox = document.querySelector('#performanceMode');
    const button = document.querySelector('#applyLaunchButton');
    const initial = {
      checked: checkbox.checked,
      disabled: checkbox.disabled,
      status: document.querySelector('#performanceModeStatus').textContent
    };
    await applyPreset('2K 120', true, button);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
    return {
      initial,
      finalChecked: checkbox.checked,
      finalStatus: document.querySelector('#performanceModeStatus').textContent
    };
  })()`);
  if (
    !performance.initial.checked ||
    performance.initial.disabled ||
    !performance.initial.status.includes('x64-3') ||
    performance.finalChecked ||
    !lastPresetPayload?.performanceMode ||
    savedPerformanceMode
  ) {
    throw new Error(`Performance mode UI mismatch: ${JSON.stringify({ performance, lastPresetPayload, savedPerformanceMode })}`);
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
      layoutHeight: Math.round(layout.getBoundingClientRect().height),
      rootDisplay: getComputedStyle(document.querySelector('#chooseRootButton')).display,
      takeoverDisplay: getComputedStyle(document.querySelector('#fpsTakeoverPill')).display
    };
  })()`);
  if (visual.rootDisplay !== 'none' || visual.takeoverDisplay === 'none') {
    throw new Error(`FPS hero controls overlap regression: ${JSON.stringify(visual)}`);
  }
  const image = await win.webContents.capturePage();
  fs.writeFileSync(output, image.toPNG());

  await win.webContents.executeJavaScript(`(() => {
    switchView('launch');
    document.querySelector('#chooseRootButton').click();
  })()`);
  await new Promise(resolve => setTimeout(resolve, 250));
  const packageVisual = await win.webContents.executeJavaScript(`(() => ({
    open: !document.querySelector('#packageMenu').hidden,
    items: document.querySelectorAll('.package-installation').length,
    current: document.querySelector('#gamePlatformLabel').textContent
  }))()`);
  if (!packageVisual.open || packageVisual.items !== 2 || packageVisual.current !== '老PC包体') {
    throw new Error(`Package menu UI mismatch: ${JSON.stringify(packageVisual)}`);
  }
  const packageImage = await win.webContents.capturePage();
  fs.writeFileSync(packageOutput, packageImage.toPNG());

  await win.webContents.executeJavaScript("switchView('tools')");
  await new Promise(resolve => setTimeout(resolve, 250));
  const supportVisual = await win.webContents.executeJavaScript(`(() => {
    const image = document.querySelector('.support-code img');
    return {
      activeView: document.querySelector('.view.active')?.id,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      cardHeight: Math.round(document.querySelector('.support-card').getBoundingClientRect().height),
      updateStatus: document.querySelector('#updateStatus').textContent
    };
  })()`);
  if (
    supportVisual.activeView !== 'toolsView' ||
    !supportVisual.complete ||
    supportVisual.naturalWidth < 500 ||
    supportVisual.cardHeight < 330 ||
    !supportVisual.updateStatus.includes('最新版本')
  ) {
    throw new Error(`Support UI mismatch: ${JSON.stringify(supportVisual)}`);
  }
  const supportImage = await win.webContents.capturePage();
  fs.writeFileSync(supportOutput, supportImage.toPNG());

  await win.webContents.executeJavaScript("switchView('history')");
  await new Promise(resolve => setTimeout(resolve, 250));
  const historyVisual = await win.webContents.executeJavaScript(`(async () => {
    const toggle = document.querySelector('#historyEnabled');
    const title = document.querySelector('.history-title-row h1').getBoundingClientRect();
    const control = document.querySelector('.history-record-toggle').getBoundingClientRect();
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    return {
      titleRight: Math.round(title.right),
      controlLeft: Math.round(control.left),
      checked: toggle.checked,
      label: document.querySelector('#historyEnabledLabel').textContent,
      badge: document.querySelector('#historyRecordingBadge').textContent
    };
  })()`);
  if (
    historyVisual.controlLeft <= historyVisual.titleRight ||
    historyVisual.checked ||
    !historyVisual.label.includes('暂停') ||
    !historyVisual.badge.includes('暂停')
  ) {
    throw new Error(`History toggle UI mismatch: ${JSON.stringify(historyVisual)}`);
  }
  const historyImage = await win.webContents.capturePage();
  fs.writeFileSync(historyOutput, historyImage.toPNG());

  process.stdout.write(`${JSON.stringify({
    performance,
    schedulingVisual,
    systemManagedVisual,
    lastPresetPayload,
    initial,
    recovered,
    cleaned,
    visual,
    packageVisual,
    supportVisual,
    historyVisual,
    performanceOutput,
    schedulingOutput,
    output,
    packageOutput,
    supportOutput,
    historyOutput
  }, null, 2)}\n`);
  app.quit();
}).catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
