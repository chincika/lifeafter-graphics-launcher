const assert = require('node:assert/strict');
const { HistoryStore } = require('./history-store');

function createStore(sessions = []) {
  const store = Object.create(HistoryStore.prototype);
  store.dataDir = 'test';
  store.sessions = sessions;
  store.lastSyncAt = 0;
  store.lastSavedAt = 0;
  store.persistIntervalMs = 60 * 1000;
  store.save = () => {};
  return store;
}

function session(pid, account, startedAt, endedAt) {
  return {
    id: `${pid}-${startedAt}`,
    pid,
    account,
    title: '',
    startedAt,
    lastSeenAt: endedAt,
    endedAt,
    active: false
  };
}

function titledSession(pid, account, title, startedAt, endedAt) {
  return { ...session(pid, account, startedAt, endedAt), title };
}

function testAccountSwitchSplitsOneProcess() {
  const store = createStore();
  const base = Date.UTC(2026, 6, 20, 8, 0, 0);
  store.syncInstances([
    { pid: 101, name: '账号_A', title: 'ID: 账号_A', runningSeconds: 3600 }
  ], base);

  store.syncInstances([
    { pid: 101, name: '账号_B', title: 'ID: 账号_B', runningSeconds: 3601 }
  ], base + 1000);
  assert.equal(store.sessions.length, 1, 'one changed frame must not split the session');

  store.syncInstances([
    { pid: 101, name: '账号_B', title: 'ID: 账号_B', runningSeconds: 3602.4 }
  ], base + 2400);

  assert.equal(store.sessions.length, 2);
  assert.equal(store.sessions[0].account, '账号_A');
  assert.equal(store.sessions[0].active, false);
  assert.equal(store.sessions[0].endedAt, base + 1000);
  assert.equal(store.sessions[1].account, '账号_B');
  assert.equal(store.sessions[1].startedAt, base + 1000);
  assert.equal(store.sessions[1].active, true);
}

function testInitialPlaceholderBecomesRealAccount() {
  const store = createStore();
  const base = Date.UTC(2026, 6, 20, 8, 0, 0);
  store.syncInstances([
    { pid: 202, name: '主号', title: '', runningSeconds: 30 }
  ], base);
  store.syncInstances([
    { pid: 202, name: '账号_C', title: 'ID: 账号_C', runningSeconds: 31 }
  ], base + 1000);

  assert.equal(store.sessions.length, 1);
  assert.equal(store.sessions[0].account, '账号_C');
  assert.equal(store.sessions[0].startedAt, base);
}

function testParallelWindowsUseWallClockUnion() {
  const hour = 60 * 60 * 1000;
  const base = Date.UTC(2026, 6, 20, 8, 0, 0);
  const store = createStore([
    session(1, '账号_A', base, base + 2 * hour),
    session(2, '账号_B', base + hour, base + 3 * hour)
  ]);

  const result = store.aggregate('total', base + 4 * hour);
  assert.equal(result.totalDurationMs, 3 * hour);
  assert.equal(result.accounts[0].durationMs, 2 * hour);
  assert.equal(result.accounts[1].durationMs, 2 * hour);
  assert.equal(result.launchCount, 2);
  assert.equal(result.averageDurationMs, 2 * hour);
}

function testSameAccountParallelWindowsAreAlsoDeduplicated() {
  const hour = 60 * 60 * 1000;
  const base = Date.UTC(2026, 6, 20, 8, 0, 0);
  const store = createStore([
    session(1, '账号_A', base, base + 2 * hour),
    session(2, '账号_A', base + hour, base + 3 * hour)
  ]);

  const result = store.aggregate('total', base + 4 * hour);
  assert.equal(result.totalDurationMs, 3 * hour);
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].durationMs, 3 * hour);
  assert.equal(result.mostUsedShare, 1);
}

function testLegacyServerSuffixMergesIntoCanonicalAccount() {
  const hour = 60 * 60 * 1000;
  const base = Date.UTC(2026, 6, 20, 8, 0, 0);
  const title = '账号_A -  - 测试服务器 - 明日之后';
  const store = createStore([
    titledSession(1, '账号_A 测试服务器', title, base, base + hour),
    titledSession(2, '账号_A', title, base + hour, base + 2 * hour)
  ]);

  const result = store.aggregate('total', base + 3 * hour);
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].account, '账号_A');
  assert.equal(result.accounts[0].durationMs, 2 * hour);
  assert.equal(result.accounts[0].launches, 2);
  assert.equal(result.recent.every(item => item.account === '账号_A'), true);
}

function testReopeningLauncherDoesNotCountAsAnotherLaunch() {
  const store = createStore();
  const base = Date.UTC(2026, 6, 20, 8, 0, 0);
  store.syncInstances([
    { pid: 303, name: '账号_D', title: '账号_D -  - 测试服务器 - 明日之后', runningSeconds: 100 }
  ], base);
  store.syncInstances([], base + 10000);
  store.syncInstances([
    { pid: 303, name: '账号_D', title: '账号_D -  - 测试服务器 - 明日之后', runningSeconds: 120 }
  ], base + 20000);

  assert.equal(store.sessions.length, 2);
  assert.equal(store.sessions[0].countsAsLaunch, true);
  assert.equal(store.sessions[1].countsAsLaunch, false);
  assert.equal(store.aggregate('total', base + 30000).launchCount, 1);
}

function testPendingSwitchDoesNotRewriteOldSessionTitle() {
  const store = createStore();
  const base = Date.UTC(2026, 6, 20, 8, 0, 0);
  const titleA = 'Account_A - - Server - Game';
  const titleB = 'Account_B - - Server - Game';

  store.syncInstances([
    { pid: 404, name: 'Account_A', title: titleA, runningSeconds: 60 }
  ], base);
  store.syncInstances([
    { pid: 404, name: 'Account_B', title: titleB, runningSeconds: 61 }
  ], base + 1000);

  assert.equal(store.sessions.length, 1);
  assert.equal(store.sessions[0].account, 'Account_A');
  assert.equal(store.sessions[0].title, titleA);

  store.syncInstances([
    { pid: 404, name: 'Account_B', title: titleB, runningSeconds: 62 }
  ], base + 2000);

  assert.equal(store.sessions.length, 2);
  assert.equal(store.sessions[0].account, 'Account_A');
  assert.equal(store.sessions[0].title, titleA);
  assert.equal(store.sessions[1].account, 'Account_B');
  assert.equal(store.sessions[1].title, titleB);
}

function testConfirmedAccountWinsOverConflictingTitle() {
  const hour = 60 * 60 * 1000;
  const base = Date.UTC(2026, 6, 20, 8, 0, 0);
  const store = createStore([
    titledSession(1, 'Account_A', 'Account_B - - Server - Game', base, base + hour)
  ]);

  assert.equal(store.canonicalAccount(store.sessions[0]), 'Account_A');
  const result = store.aggregate('total', base + 2 * hour);
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].account, 'Account_A');
  assert.equal(result.recent[0].account, 'Account_A');
}

function testOutOfOrderPollCannotUndoAccountSwitch() {
  const store = createStore();
  const base = Date.UTC(2026, 6, 20, 8, 0, 0);
  store.syncInstances([
    { pid: 505, name: 'Account_A', title: 'Account_A - - Server - Game' }
  ], base);
  store.syncInstances([
    { pid: 505, name: 'Account_B', title: 'Account_B - - Server - Game' }
  ], base + 2000);
  store.syncInstances([
    { pid: 505, name: 'Account_A', title: 'Account_A - - Server - Game' }
  ], base + 1000);
  store.syncInstances([
    { pid: 505, name: 'Account_B', title: 'Account_B - - Server - Game' }
  ], base + 3000);

  assert.equal(store.sessions.length, 2);
  assert.equal(store.sessions[0].account, 'Account_A');
  assert.equal(store.sessions[1].account, 'Account_B');
}

function testActiveHeartbeatIsPersistedAtMostOncePerMinute() {
  const store = createStore();
  const base = Date.UTC(2026, 6, 20, 8, 0, 0);
  let saves = 0;
  store.save = () => {
    saves += 1;
    store.lastSavedAt = store.lastSyncAt;
  };

  store.syncInstances([{ pid: 606, name: 'Account_A' }], base);
  assert.equal(saves, 1, 'new sessions must be saved immediately');
  store.syncInstances([{ pid: 606, name: 'Account_A' }], base + 5000);
  store.syncInstances([{ pid: 606, name: 'Account_A' }], base + 55000);
  assert.equal(saves, 1, 'active polling must not write on every capture');
  store.syncInstances([{ pid: 606, name: 'Account_A' }], base + 61000);
  assert.equal(saves, 2, 'active sessions must receive a periodic safety flush');
  store.syncInstances([], base + 62000);
  assert.equal(saves, 3, 'session end must be saved immediately');
}

testAccountSwitchSplitsOneProcess();
testInitialPlaceholderBecomesRealAccount();
testParallelWindowsUseWallClockUnion();
testSameAccountParallelWindowsAreAlsoDeduplicated();
testLegacyServerSuffixMergesIntoCanonicalAccount();
testReopeningLauncherDoesNotCountAsAnotherLaunch();
testPendingSwitchDoesNotRewriteOldSessionTitle();
testConfirmedAccountWinsOverConflictingTitle();
testOutOfOrderPollCannotUndoAccountSwitch();
testActiveHeartbeatIsPersistedAtMostOncePerMinute();

console.log('history-store tests passed');
