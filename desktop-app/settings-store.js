const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = Object.freeze({
  minimizeToTray: true,
  autoStart: false,
  trayTipShown: false,
  lanEnabled: false,
  lanPort: 17666,
  trustedDevices: []
});

class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { ...DEFAULT_SETTINGS };
    this.lastDevicePersistAt = 0;
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.data = this.normalize({ ...DEFAULT_SETTINGS, ...parsed });
    } catch {
      this.data = { ...DEFAULT_SETTINGS };
    }
    return this.get();
  }

  normalize(value) {
    return {
      minimizeToTray: value.minimizeToTray !== false,
      autoStart: value.autoStart === true,
      trayTipShown: value.trayTipShown === true,
      lanEnabled: value.lanEnabled === true,
      lanPort: Number.isInteger(Number(value.lanPort)) &&
        Number(value.lanPort) >= 1024 &&
        Number(value.lanPort) <= 65535
        ? Number(value.lanPort)
        : DEFAULT_SETTINGS.lanPort,
      trustedDevices: Array.isArray(value.trustedDevices)
        ? value.trustedDevices
          .filter(item => item && item.id && item.tokenHash)
          .map(item => ({
            id: String(item.id),
            tokenHash: String(item.tokenHash),
            name: String(item.name || '未知设备').slice(0, 80),
            address: String(item.address || '').slice(0, 80),
            createdAt: Number(item.createdAt) || Date.now(),
            lastSeenAt: Number(item.lastSeenAt) || Number(item.createdAt) || Date.now()
          }))
          .slice(0, 20)
        : []
    };
  }

  get() {
    return {
      ...this.data,
      trustedDevices: this.data.trustedDevices.map(item => ({ ...item }))
    };
  }

  update(patch) {
    this.data = this.normalize({ ...this.data, ...(patch || {}) });
    this.save();
    return this.get();
  }

  touchDevice(id, address, timestamp = Date.now()) {
    const device = this.data.trustedDevices.find(item => item.id === id);
    if (!device) return null;
    device.lastSeenAt = Number(timestamp) || Date.now();
    if (address) device.address = String(address).slice(0, 80);
    if (device.lastSeenAt - this.lastDevicePersistAt >= 5 * 60 * 1000) {
      this.lastDevicePersistAt = device.lastSeenAt;
      this.save();
    }
    return { ...device };
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify({
      version: 1,
      ...this.data,
      updatedAt: Date.now()
    }, null, 2), 'utf8');
    try {
      fs.renameSync(tempPath, this.filePath);
    } catch {
      fs.copyFileSync(tempPath, this.filePath);
      fs.unlinkSync(tempPath);
    }
  }
}

module.exports = { SettingsStore, DEFAULT_SETTINGS };
