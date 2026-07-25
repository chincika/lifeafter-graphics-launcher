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
  openBackups: () => ipcRenderer.invoke('launcher:open-backups'),
  openLog: () => ipcRenderer.invoke('launcher:open-log'),
  getHistory: (range) => ipcRenderer.invoke('launcher:get-history', range),
  exportHistory: (range) => ipcRenderer.invoke('launcher:export-history', range),
  openHistoryFolder: () => ipcRenderer.invoke('launcher:open-history-folder')
});
