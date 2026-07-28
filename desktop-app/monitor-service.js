const { EventEmitter } = require('node:events');

class MonitorService extends EventEmitter {
  constructor(options) {
    super();
    this.capture = options.capture;
    this.historyStore = options.historyStore;
    this.historyEnabled = options.historyEnabled !== false;
    this.visible = false;
    this.remoteClientCount = 0;
    this.running = false;
    this.timer = null;
    this.inFlight = null;
    this.snapshot = {
      capturedAt: Date.now(),
      instances: []
    };
    this.lastError = '';
  }

  intervalMs() {
    if (this.visible) return 2000;
    if (this.remoteClientCount > 0) {
      return this.snapshot.instances.length ? 3000 : 5000;
    }
    return this.snapshot.instances.length ? 5000 : 15000;
  }

  setVisible(value) {
    const next = Boolean(value);
    if (this.visible === next) return;
    this.visible = next;
    if (this.running) this.schedule(0);
  }

  setRemoteClientCount(value) {
    const next = Math.max(0, Number(value) || 0);
    if (this.remoteClientCount === next) return;
    this.remoteClientCount = next;
    if (this.running) this.schedule(0);
  }

  setHistoryEnabled(value, capturedAt = Date.now()) {
    const next = Boolean(value);
    if (this.historyEnabled === next) return;
    if (!next) this.historyStore?.syncInstances([], capturedAt);
    this.historyEnabled = next;
    if (this.running) this.schedule(0);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  async stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight) {
      try {
        await this.inFlight;
      } catch {
      }
    }
  }

  schedule(delay = this.intervalMs()) {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refreshNow().finally(() => {
        if (this.running) this.schedule();
      });
    }, Math.max(0, Number(delay) || 0));
    this.timer.unref?.();
  }

  async refreshNow() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      const result = await this.capture();
      if (!result?.ok) {
        this.lastError = result?.error || '实例检测失败';
        this.emit('error-state', this.lastError);
        return { ok: false, error: this.lastError };
      }
      const data = result.data || { capturedAt: Date.now(), instances: [] };
      data.capturedAt = Number(data.capturedAt) || Date.now();
      data.instances = Array.isArray(data.instances) ? data.instances : [];
      this.snapshot = data;
      this.lastError = '';
      if (this.historyEnabled) {
        this.historyStore?.syncInstances(data.instances, data.capturedAt);
      }
      this.emit('snapshot', this.getSnapshot());
      return { ok: true, data: this.getSnapshot() };
    })();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  getSnapshot() {
    return {
      ...this.snapshot,
      instances: this.snapshot.instances.map(item => ({ ...item }))
    };
  }
}

module.exports = { MonitorService };
