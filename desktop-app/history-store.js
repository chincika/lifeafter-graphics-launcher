const fs = require('node:fs');
const path = require('node:path');

class HistoryStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'launch-history.json');
    this.sessions = [];
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    } catch {
      this.sessions = [];
    }
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      sessions: this.sessions
    }, null, 2), 'utf8');
  }

  syncInstances(instances, capturedAt = Date.now()) {
    const currentPids = new Set();
    let changed = false;

    for (const instance of instances || []) {
      const pid = Number(instance.pid);
      if (!pid) continue;
      currentPids.add(pid);
      let session = this.sessions.find(item => item.active && item.pid === pid);
      const detectedStart = capturedAt - Math.max(0, Number(instance.runningSeconds) || 0) * 1000;
      const name = String(instance.name || '').trim() || `实例_${pid}`;

      if (!session) {
        session = {
          id: `${pid}-${detectedStart}`,
          pid,
          account: name,
          title: String(instance.title || ''),
          startedAt: detectedStart,
          lastSeenAt: capturedAt,
          endedAt: null,
          active: true
        };
        this.sessions.push(session);
        changed = true;
      } else {
        if (session.account !== name && !/^实例_\d+$/.test(name)) {
          session.account = name;
          session.title = String(instance.title || session.title || '');
          changed = true;
        }
        session.lastSeenAt = capturedAt;
      }
    }

    for (const session of this.sessions) {
      if (session.active && !currentPids.has(session.pid)) {
        session.active = false;
        session.endedAt = Math.max(session.startedAt, session.lastSeenAt || capturedAt);
        changed = true;
      }
    }

    if (changed || currentPids.size) this.save();
  }

  rangeBounds(range, now = new Date()) {
    const end = now.getTime();
    if (range === 'total') return { start: 0, end, previousStart: 0, previousEnd: 0 };

    let start;
    let previousStart;
    let previousEnd;
    if (range === 'day') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      previousEnd = start;
      previousStart = start - 24 * 60 * 60 * 1000;
    } else if (range === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      previousEnd = start;
      previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    } else {
      const weekday = (now.getDay() + 6) % 7;
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday).getTime();
      previousEnd = start;
      previousStart = start - 7 * 24 * 60 * 60 * 1000;
    }
    return { start, end, previousStart, previousEnd };
  }

  clippedDuration(session, start, end) {
    const sessionStart = Number(session.startedAt) || 0;
    const sessionEnd = session.active ? Date.now() : Number(session.endedAt || session.lastSeenAt || sessionStart);
    return Math.max(0, Math.min(sessionEnd, end) - Math.max(sessionStart, start));
  }

  aggregate(range = 'week') {
    const bounds = this.rangeBounds(range);
    const rows = this.sessions
      .map(session => ({ session, durationMs: this.clippedDuration(session, bounds.start, bounds.end) }))
      .filter(item => item.durationMs > 0);

    const accountMap = new Map();
    for (const row of rows) {
      const key = row.session.account || `实例_${row.session.pid}`;
      const current = accountMap.get(key) || { account: key, durationMs: 0, launches: 0 };
      current.durationMs += row.durationMs;
      if (Number(row.session.startedAt) >= bounds.start && Number(row.session.startedAt) < bounds.end) {
        current.launches += 1;
      }
      accountMap.set(key, current);
    }

    const accounts = [...accountMap.values()].sort((a, b) => b.durationMs - a.durationMs);
    const totalDurationMs = rows.reduce((sum, item) => sum + item.durationMs, 0);
    const launchCount = this.sessions.filter(session =>
      Number(session.startedAt) >= bounds.start && Number(session.startedAt) < bounds.end).length;
    const previousDurationMs = bounds.previousEnd
      ? this.sessions.reduce((sum, session) =>
          sum + this.clippedDuration(session, bounds.previousStart, bounds.previousEnd), 0)
      : 0;
    const previousLaunchCount = bounds.previousEnd
      ? this.sessions.filter(session =>
          Number(session.startedAt) >= bounds.previousStart &&
          Number(session.startedAt) < bounds.previousEnd).length
      : 0;

    const recent = [...this.sessions]
      .filter(session => this.clippedDuration(session, bounds.start, bounds.end) > 0)
      .sort((a, b) => Number(b.startedAt) - Number(a.startedAt))
      .slice(0, 12)
      .map(session => ({
        id: session.id,
        pid: session.pid,
        account: session.account,
        startedAt: session.startedAt,
        endedAt: session.active ? null : session.endedAt,
        active: session.active,
        durationMs: this.clippedDuration(session, bounds.start, bounds.end)
      }));

    return {
      range,
      generatedAt: Date.now(),
      totalDurationMs,
      launchCount,
      averageDurationMs: launchCount ? totalDurationMs / launchCount : 0,
      mostUsedAccount: accounts[0]?.account || '暂无',
      mostUsedShare: totalDurationMs ? (accounts[0]?.durationMs || 0) / totalDurationMs : 0,
      durationDeltaMs: totalDurationMs - previousDurationMs,
      launchDelta: launchCount - previousLaunchCount,
      accounts,
      recent,
      dataDir: this.dataDir
    };
  }

  exportCsv(range = 'total') {
    const bounds = this.rangeBounds(range);
    const lines = [['账号 ID', 'PID', '开始时间', '结束时间', '时长（秒）', '状态']];
    for (const session of this.sessions) {
      const duration = this.clippedDuration(session, bounds.start, bounds.end);
      if (duration <= 0) continue;
      lines.push([
        session.account,
        session.pid,
        new Date(session.startedAt).toLocaleString('zh-CN'),
        session.active ? '' : new Date(session.endedAt).toLocaleString('zh-CN'),
        Math.round(duration / 1000),
        session.active ? '运行中' : '已结束'
      ]);
    }
    return `\uFEFF${lines.map(row => row.map(value =>
      `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')}`;
  }
}

module.exports = { HistoryStore };
