const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  init: () => ipcRenderer.invoke('launcher:init'),
  chooseGameRoot: () => ipcRenderer.invoke('launcher:choose-root'),
  applyPreset: (preset, launch) => ipcRenderer.invoke('launcher:apply-preset', { preset, launch }),
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
  openLog: () => ipcRenderer.invoke('launcher:open-log'),
  getHistory: (range) => ipcRenderer.invoke('launcher:get-history', range),
  exportHistory: (range) => ipcRenderer.invoke('launcher:export-history', range),
  openHistoryFolder: () => ipcRenderer.invoke('launcher:open-history-folder')
});
