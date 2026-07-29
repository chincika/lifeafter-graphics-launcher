const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  init: () => ipcRenderer.invoke('launcher:init'),
  chooseGameRoot: () => ipcRenderer.invoke('launcher:choose-root'),
  scanGameRoots: () => ipcRenderer.invoke('launcher:scan-roots'),
  switchGameRoot: (root) => ipcRenderer.invoke('launcher:switch-root', root),
  removeGameRoot: (root) => ipcRenderer.invoke('launcher:remove-root', root),
  applyPreset: (preset, launch, performanceMode = false) =>
    ipcRenderer.invoke('launcher:apply-preset', { preset, launch, performanceMode }),
  setPerformanceMode: (enabled) => ipcRenderer.invoke('launcher:set-performance-mode', enabled),
  getProcessScheduling: () => ipcRenderer.invoke('launcher:get-process-scheduling'),
  saveProcessPolicy: (preset, policy) =>
    ipcRenderer.invoke('launcher:save-process-policy', { preset, policy }),
  readSummary: () => ipcRenderer.invoke('launcher:read-summary'),
  getInstances: () => ipcRenderer.invoke('launcher:get-instances'),
  restoreLatest: () => ipcRenderer.invoke('launcher:restore-latest'),
  restoreFactory: () => ipcRenderer.invoke('launcher:restore-factory'),
  cleanBackups: () => ipcRenderer.invoke('launcher:clean-backups'),
  setTiaozi: (scale) => ipcRenderer.invoke('launcher:set-tiaozi', scale),
  getFpsStatus: () => ipcRenderer.invoke('launcher:get-fps-status'),
  saveFpsTarget: (target) => ipcRenderer.invoke('launcher:save-fps-target', target),
  applyFpsUnlock: (target) => ipcRenderer.invoke('launcher:apply-fps', target),
  restoreFpsUnlock: () => ipcRenderer.invoke('launcher:restore-fps'),
  cleanFpsBackups: () => ipcRenderer.invoke('launcher:clean-fps-backups'),
  openBackups: () => ipcRenderer.invoke('launcher:open-backups'),
  openFpsBackups: () => ipcRenderer.invoke('launcher:open-fps-backups'),
  openFpsProtectedBackups: () => ipcRenderer.invoke('launcher:open-fps-protected-backups'),
  openLog: () => ipcRenderer.invoke('launcher:open-log'),
  getHistory: (range) => ipcRenderer.invoke('launcher:get-history', range),
  setHistoryEnabled: (enabled) => ipcRenderer.invoke('launcher:set-history-enabled', enabled),
  getUpdateState: () => ipcRenderer.invoke('launcher:get-update-state'),
  setUpdateFrequency: (frequency) =>
    ipcRenderer.invoke('launcher:set-update-frequency', frequency),
  checkForUpdates: () => ipcRenderer.invoke('launcher:check-for-updates'),
  exportHistory: (range) => ipcRenderer.invoke('launcher:export-history', range),
  openHistoryFolder: () => ipcRenderer.invoke('launcher:open-history-folder'),
  getBackgroundState: () => ipcRenderer.invoke('launcher:get-background-state'),
  setBackgroundOption: (key, value) =>
    ipcRenderer.invoke('launcher:set-background-option', { key, value }),
  rotatePairingCode: () => ipcRenderer.invoke('launcher:rotate-pairing-code'),
  revokeRemoteDevice: (id) => ipcRenderer.invoke('launcher:revoke-remote-device', id),
  revokeAllRemoteDevices: () => ipcRenderer.invoke('launcher:revoke-all-remote-devices'),
  openRemotePage: () => ipcRenderer.invoke('launcher:open-remote-page'),
  copyText: (value) => ipcRenderer.invoke('launcher:copy-text', value),
  onInstancesUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('launcher:instances-updated', listener);
    return () => ipcRenderer.removeListener('launcher:instances-updated', listener);
  },
  onBackgroundUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('launcher:background-updated', listener);
    return () => ipcRenderer.removeListener('launcher:background-updated', listener);
  },
  onUpdateState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('launcher:update-state', listener);
    return () => ipcRenderer.removeListener('launcher:update-state', listener);
  }
});
