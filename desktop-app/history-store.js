const fs = require('node:fs');
const path = require('node:path');

class HistoryStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'launch-history.json');
    this.sessions = [];
    this.lastSyncAt = 0;
    this.lastSavedAt = 0;
    this.persistIntervalMs = 60 * 1000;
    this.load();
  }

  load() {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      this.sessions = [];
      return;
    }

    this.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    let migrated = false;
    for (const session of this.sessions) {
      const normalized = this.canonicalAccount(session);
      if (normalized && normalized !== session.account) {
        session.account = normalized;
        migrated = true;
      }
      if (!session.active && session.pendingAccount) {
        this.clearPendingAccount(session);
        migrated = true;
      }
    }
    if (migrated || Number(parsed.version) < 4) {
      try {
        this.save();
      } catch {
        // Keep the successfully loaded history in memory. A later polling save
        // can retry persistence without discarding the user's records.
      }
    }
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify({
      version: 4,
      updatedAt: Date.now(),
      sessions: this.sessions
    }, null, 2), 'utf8');
    this.lastSavedAt = Date.now();
  }

  isPlaceholderAccount(name, pid) {
    const value = String(name || '').trim();
    return !value ||
      value === '主号' ||
      /^小号(?:\s*\d+)?$/.test(value) ||
      value === `实例_${pid}`;
  }

  accountFromTitle(title) {
    const match = String(title || '').match(/^\s*(.+?)\s+-\s+/);
    if (!match) return '';
    const candidate = match[1].trim();
    return candidate.length >= 2 && candidate.length <= 32 ? candidate : '';
  }

  canonicalAccount(session) {
    const account = String(session?.account || '').trim();
    const pid = Number(session?.pid);
    const titleAccount = this.accountFromTitle(session?.title);
    if (!account || this.isPlaceholderAccount(account, pid)) {
      return titleAccount || account || `实例_${pid}`;
    }
    // Older builds stored "account + server" in the account field. This is the
    // only case where a title may shorten an already confirmed account ID.
    if (titleAccount && account.startsWith(`${titleAccount} `)) {
      return titleAccount;
    }
    // A confirmed account wins over a conflicting title. During an in-game
    // switch the window title can change one poll before confirmation.
    return account;
  }

  createSession(pid, account, title, startedAt, lastSeenAt, options = {}) {
    const session = {
      id: `${pid}-${startedAt}-${this.sessions.length}`,
      pid,
      account,
      title,
      startedAt,
      lastSeenAt,
      endedAt: null,
      active: true,
      processStartedAt: Number(options.processStartedAt) || startedAt,
      countsAsLaunch: options.countsAsLaunch !== false
    };
    this.sessions.push(session);
    return session;
  }

  clearPendingAccount(session) {
    delete session.pendingAccount;
    delete session.pendingAccountAt;
    delete session.pendingAccountCount;
  }

  syncInstances(instances, capturedAt = Date.now()) {
    capturedAt = Number(capturedAt) || Date.now();
    if (capturedAt < Number(this.lastSyncAt || 0)) return;
    this.lastSyncAt = capturedAt;
    const currentPids = new Set();
    let changed = false;

    for (const instance of instances || []) {
      const pid = Number(instance.pid);
      if (!pid) continue;
      currentPids.add(pid);
      let session = this.sessions.find(item => item.active && item.pid === pid);
      const processStartedAt = capturedAt -
        Math.max(0, Number(instance.runningSeconds) || 0) * 1000;
      const title = String(instance.title || '');
      const name = this.accountFromTitle(title) ||
        String(instance.name || '').trim() ||
        `实例_${pid}`;

      if (!session) {
        // History starts when this launcher actually observes the account.
        // Using the OS process start time would incorrectly assign time from
        // earlier in-game accounts to whichever account is visible now.
        const previous = [...this.sessions].reverse().find(item => {
          if (item.active || item.pid !== pid) return false;
          const previousAccount = this.canonicalAccount(item);
          if (previousAccount !== name) return false;
          const knownProcessStart = Number(item.processStartedAt);
          if (knownProcessStart) return Math.abs(knownProcessStart - processStartedAt) < 5000;
          const itemStart = Number(item.startedAt) || 0;
          const itemEnd = Number(item.endedAt || item.lastSeenAt) || 0;
          return itemStart >= processStartedAt - 5000 &&
            itemEnd >= itemStart &&
            itemEnd <= capturedAt;
        });
        this.createSession(pid, name, title, capturedAt, capturedAt, {
          processStartedAt,
          countsAsLaunch: !previous
        });
        changed = true;
      } else {
        const currentIsPlaceholder = this.isPlaceholderAccount(session.account, pid);
        const observedIsPlaceholder = this.isPlaceholderAccount(name, pid);

        if (session.account === name) {
          if (session.pendingAccount) {
            this.clearPendingAccount(session);
            changed = true;
          }
        } else if (currentIsPlaceholder && !observedIsPlaceholder) {
          // The initial window existed before its game ID appeared. Assign that ID
          // to the original session instead of creating a short placeholder session.
          session.account = name;
          session.title = title || session.title || '';
          this.clearPendingAccount(session);
          changed = true;
        } else if (!currentIsPlaceholder && !observedIsPlaceholder) {
          // A real ID changed inside the same process. Require two consecutive
          // observations to avoid splitting on a transient window-title frame.
          if (session.pendingAccount === name) {
            session.pendingAccountCount = Number(session.pendingAccountCount || 1) + 1;
          } else {
            session.pendingAccount = name;
            session.pendingAccountAt = capturedAt;
            session.pendingAccountCount = 1;
          }
          changed = true;

          if (session.pendingAccountCount >= 2) {
            const switchAt = Math.max(
              Number(session.startedAt) || capturedAt,
              Math.min(capturedAt, Number(session.pendingAccountAt) || capturedAt)
            );
            session.active = false;
            session.endedAt = switchAt;
            session.lastSeenAt = switchAt;
            this.clearPendingAccount(session);
            session = this.createSession(pid, name, title, switchAt, capturedAt, {
              processStartedAt: Number(session.processStartedAt) || processStartedAt,
              countsAsLaunch: true
            });
          }
        } else if (session.pendingAccount) {
          this.clearPendingAccount(session);
          changed = true;
        }

        // Do not overwrite the old session while a possible account switch is
        // pending. After confirmation `session` points to the newly created row.
        if (session.account === name) {
          session.title = title || session.title || '';
        }
        session.lastSeenAt = capturedAt;
      }
    }

    for (const session of this.sessions) {
      if (session.active && !currentPids.has(session.pid)) {
        session.active = false;
        session.endedAt = Math.max(session.startedAt, session.lastSeenAt || capturedAt);
        this.clearPendingAccount(session);
        changed = true;
      }
    }

    const heartbeatDue = currentPids.size &&
      capturedAt - Number(this.lastSavedAt || 0) >= this.persistIntervalMs;
    if (changed || heartbeatDue) this.save();
  }

  flush() {
    this.save();
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
    const interval = this.clippedInterval(session, start, end);
    return interval ? interval[1] - interval[0] : 0;
  }

  clippedInterval(session, start, end, generatedAt = Date.now()) {
    const sessionStart = Number(session.startedAt) || 0;
    const sessionEnd = session.active
      ? generatedAt
      : Number(session.endedAt || session.lastSeenAt || sessionStart);
    const clippedStart = Math.max(sessionStart, start);
    const clippedEnd = Math.min(sessionEnd, end);
    return clippedEnd > clippedStart ? [clippedStart, clippedEnd] : null;
  }

  unionDuration(intervals) {
    if (!intervals.length) return 0;
    const sorted = intervals
      .filter(Boolean)
      .map(interval => [Number(interval[0]), Number(interval[1])])
      .filter(interval => interval[1] > interval[0])
      .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    if (!sorted.length) return 0;

    let total = 0;
    let currentStart = sorted[0][0];
    let currentEnd = sorted[0][1];
    for (let index = 1; index < sorted.length; index++) {
      const [start, end] = sorted[index];
      if (start <= currentEnd) {
        currentEnd = Math.max(currentEnd, end);
      } else {
        total += currentEnd - currentStart;
        currentStart = start;
        currentEnd = end;
      }
    }
    return total + currentEnd - currentStart;
  }

  aggregate(range = 'week', generatedAt = Date.now()) {
    const bounds = this.rangeBounds(range, new Date(generatedAt));
    const rows = this.sessions
      .map(session => {
        const interval = this.clippedInterval(session, bounds.start, bounds.end, generatedAt);
        return { session, interval, durationMs: interval ? interval[1] - interval[0] : 0 };
      })
      .filter(item => item.interval);

    const accountMap = new Map();
    for (const row of rows) {
      const key = this.canonicalAccount(row.session);
      const current = accountMap.get(key) || { account: key, intervals: [], launches: 0 };
      current.intervals.push(row.interval);
      if (row.session.countsAsLaunch !== false &&
          Number(row.session.startedAt) >= bounds.start &&
          Number(row.session.startedAt) < bounds.end) {
        current.launches += 1;
      }
      accountMap.set(key, current);
    }

    const accounts = [...accountMap.values()]
      .map(item => ({
        account: item.account,
        durationMs: this.unionDuration(item.intervals),
        launches: item.launches
      }))
      .sort((a, b) => b.durationMs - a.durationMs);
    const totalDurationMs = this.unionDuration(rows.map(item => item.interval));
    const launchedRows = rows.filter(row =>
      row.session.countsAsLaunch !== false &&
      Number(row.session.startedAt) >= bounds.start &&
      Number(row.session.startedAt) < bounds.end);
    const launchCount = this.sessions.filter(session =>
      session.countsAsLaunch !== false &&
      Number(session.startedAt) >= bounds.start &&
      Number(session.startedAt) < bounds.end).length;
    const averageDurationMs = launchCount
      ? launchedRows.reduce((sum, row) => sum + row.durationMs, 0) / launchCount
      : 0;
    const previousDurationMs = bounds.previousEnd
      ? this.unionDuration(this.sessions.map(session =>
          this.clippedInterval(
            session,
            bounds.previousStart,
            bounds.previousEnd,
            generatedAt
          )))
      : 0;
    const previousLaunchCount = bounds.previousEnd
      ? this.sessions.filter(session =>
          session.countsAsLaunch !== false &&
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
        account: this.canonicalAccount(session),
        startedAt: session.startedAt,
        endedAt: session.active ? null : session.endedAt,
        active: session.active,
        durationMs: this.clippedDuration(session, bounds.start, bounds.end)
      }));

    return {
      range,
      generatedAt,
      totalDurationMs,
      launchCount,
      averageDurationMs,
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
        this.canonicalAccount(session),
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
