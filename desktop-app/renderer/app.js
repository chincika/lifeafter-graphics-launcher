const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const presets = {
  '2K 120': { label: '2K', resolution: '2560 × 1440', fps: '120 FPS', tone: '极致画质' },
  '1080p 120': { label: '1080p', resolution: '1920 × 1080', fps: '120 FPS', tone: '高清画质' },
  '1080p 60': { label: '1080p', resolution: '1920 × 1080', fps: '60 FPS', tone: '高清画质' },
  '900p 120': { label: '900p', resolution: '1600 × 900', fps: '120 FPS', tone: '均衡画质' },
  '900p 60': { label: '900p', resolution: '1600 × 900', fps: '60 FPS', tone: '均衡画质' },
  '720p 60': { label: '720p', resolution: '1280 × 720', fps: '60 FPS', tone: '流畅画质' },
  '540p 60': { label: '540p', resolution: '960 × 540', fps: '60 FPS', tone: '流畅画质' },
  '540p 25': { label: '540p', resolution: '960 × 540', fps: '25 FPS', tone: '最低负载' }
};

let lastDetail = '';
let busy = false;
let currentView = 'launch';
let currentHistoryRange = 'week';
let historyLoading = false;
let lastHistoryRefresh = 0;
let fpsStatus = null;
let selectedFpsTarget = 180;
let busyButton = null;
let fpsStatusLoading = false;
let backgroundState = null;
let backgroundLoading = false;
let unsubscribeInstances = null;
let unsubscribeBackground = null;

function icon(name) {
  return `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setActivity(message, detail = '', kind = 'success') {
  const now = new Date();
  $('#activityTime').textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
  $('#activityMessage').textContent = message;
  lastDetail = detail || message;
  const iconBox = $('.activity-icon');
  iconBox.innerHTML = kind === 'error' ? icon('info') : icon('check');
  iconBox.style.color = kind === 'error' ? 'var(--danger)' : '#a8f1cf';
  iconBox.style.background = kind === 'error' ? 'rgba(239,107,114,.12)' : 'rgba(67,208,138,.12)';
}

function syncFpsActionAvailability() {
  const applyButton = $('#applyFpsUnlock');
  const restoreButton = $('#restoreFpsUnlock');
  const cleanButton = $('#cleanFpsBackups');
  const refreshButton = $('#refreshFpsStatus');
  const state = String(fpsStatus?.state || '');
  const safe = Boolean(
    fpsStatus &&
    fpsStatus.compatible &&
    state !== 'unknown' &&
    !fpsStatus.gameRunning
  );

  if (applyButton) applyButton.disabled = busy || !safe;
  if (restoreButton) restoreButton.disabled = busy || !safe || state === 'original';
  if (cleanButton) {
    cleanButton.disabled = busy || !fpsStatus?.baselineReady;
  }
  if (refreshButton) refreshButton.disabled = busy || fpsStatusLoading;
  $$('.fps-target').forEach(button => {
    button.disabled = busy;
  });
}

function setBusy(value, activeButton) {
  if (busyButton && (!value || busyButton !== activeButton)) {
    busyButton.classList.remove('loading');
  }
  busy = value;
  $$('.button, .tool-tile, .row-run').forEach(button => button.disabled = value);
  if (value && activeButton) {
    busyButton = activeButton;
    busyButton.classList.add('loading');
  } else if (!value) {
    busyButton = null;
  }
  syncFpsActionAvailability();
}

function fpsPresentation(preset) {
  const native120 = preset.fps === '120 FPS';
  if (!fpsStatus) return { title: preset.fps, detail: preset.fps };
  if (String(fpsStatus.state).startsWith('conditional-') && native120) {
    return {
      title: `实际 ${fpsStatus.target} FPS`,
      detail: `配置 120 · 实际 ${fpsStatus.target} FPS`
    };
  }
  if (String(fpsStatus.state).startsWith('legacy-')) {
    return {
      title: `实际 ${fpsStatus.target} FPS`,
      detail: `旧补丁全局强制 ${fpsStatus.target} FPS`
    };
  }
  return { title: preset.fps, detail: preset.fps };
}

function updatePreset(value) {
  const preset = presets[value] || presets['2K 120'];
  const fps = fpsPresentation(preset);
  $('#presetSelect').value = value;
  $('#resolutionLabel').textContent = preset.label;
  $('#fpsLabel').textContent = fps.title;
  $('#resolutionValue').textContent = preset.resolution;
  $('#fpsValue').textContent = fps.detail;
  $$('.quality-tabs button').forEach(button => {
    button.classList.toggle('active', button.dataset.preset === value);
  });
}

function presetForResolution(width, height, index) {
  const configured = index === 0 ? $('#mainPreset').value : $('#idlePreset').value;
  if (width && height) {
    const match = Object.entries(presets).find(([, value]) =>
      value.resolution.replaceAll(' ', '') === `${width}×${height}`);
    if (match) return presets[configured] || match[1];
  }
  return presets[configured] || presets['540p 25'];
}

function renderPlanRows() {
  const count = Number($('#idleCount').value);
  const mainPreset = $('#mainPreset').value;
  const idlePreset = $('#idlePreset').value;
  const rows = [{ name: '主号方案', preset: mainPreset, main: true }];
  for (let index = 0; index < count; index++) {
    rows.push({ name: `小号方案 ${index + 1}`, preset: idlePreset, main: false });
  }
  $('#planRows').innerHTML = rows.map((row, index) => {
    const info = presets[row.preset];
    return `<div class="plan-row">
      <span class="row-icon">${icon('monitor')}</span>
      <span class="plan-name"><b>${row.name}</b><small>${escapeHtml(row.preset)} · ${info.tone}</small></span>
      <span class="plan-meta">${info.resolution}</span>
      <span class="plan-meta">${escapeHtml(fpsPresentation(info).detail)}</span>
      <button class="row-run" data-run-index="${index}" aria-label="启动${row.name}">${icon('play')}</button>
    </div>`;
  }).join('');

  $$('.row-run').forEach(button => {
    button.addEventListener('click', async () => {
      const index = Number(button.dataset.runIndex);
      const preset = index === 0 ? $('#mainPreset').value : $('#idlePreset').value;
      await applyPreset(preset, true, button);
    });
  });
}

function formatDuration(totalSeconds) {
  const total = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = Math.floor(total % 60);
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
}

function formatHistoryDuration(durationMs, compact = false) {
  const totalMinutes = Math.max(0, Math.floor((Number(durationMs) || 0) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes % 1440 / 60);
  const minutes = totalMinutes % 60;
  if (compact && days) return `${days}天 ${hours}小时`;
  if (days) return `${days}天${hours}小时${minutes}分`;
  if (hours) return `${hours}小时${minutes}分`;
  if (minutes) return `${minutes}分钟`;
  return '不足1分钟';
}

function formatSessionTime(timestamp, active = false) {
  if (active) return '运行中';
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function renderHistory(data) {
  const total = Number(data.totalDurationMs) || 0;
  const launches = Number(data.launchCount) || 0;
  $('#historyTotal').textContent = total ? formatHistoryDuration(total) : '0小时0分';
  $('#historyLaunches').textContent = `${launches}次`;
  $('#historyMostUsed').textContent = data.mostUsedAccount || '暂无';
  $('#historyAverage').textContent = data.averageDurationMs
    ? formatHistoryDuration(data.averageDurationMs)
    : '0分钟';

  const comparison = currentHistoryRange === 'total' ? '全部已记录会话' : '较上一周期';
  const durationDelta = Number(data.durationDeltaMs) || 0;
  const launchDelta = Number(data.launchDelta) || 0;
  $('#historyDurationDelta').textContent = total
    ? `${comparison}${currentHistoryRange === 'total' ? '' : ` ${durationDelta >= 0 ? '+' : '-'}${formatHistoryDuration(Math.abs(durationDelta), true)}`}`
    : '本周期暂无记录';
  $('#historyLaunchDelta').textContent = launches
    ? `${comparison}${currentHistoryRange === 'total' ? '' : ` ${launchDelta >= 0 ? '+' : ''}${launchDelta} 次`}`
    : '本周期暂无启动';
  $('#historyMostUsedShare').textContent = launches
    ? `占总时长 ${Math.round((Number(data.mostUsedShare) || 0) * 100)}%`
    : '等待首次检测';

  const accounts = data.accounts || [];
  $('#historyAccountCount').textContent = `${accounts.length} 个账号`;
  const maxDuration = Math.max(1, ...accounts.map(item => Number(item.durationMs) || 0));
  $('#accountRanking').innerHTML = accounts.length
    ? accounts.slice(0, 8).map((item, index) => `<div class="ranking-row">
        <span class="ranking-number">${index + 1}</span>
        <span class="ranking-account"><b>${escapeHtml(item.account)}</b><small>${item.launches} 次启动</small></span>
        <span class="ranking-track"><i style="width:${Math.max(3, item.durationMs / maxDuration * 100)}%"></i></span>
        <span class="ranking-time">${formatHistoryDuration(item.durationMs, true)}</span>
      </div>`).join('')
    : `<div class="history-empty">${icon('clock')}<b>还没有启动记录</b><span>检测到游戏进程后会自动开始统计</span></div>`;

  const recent = data.recent || [];
  $('#sessionRows').innerHTML = recent.length
    ? recent.map(session => `<div class="session-row">
        <span class="session-account"><i class="${session.active ? 'active' : ''}"></i><b>${escapeHtml(session.account || `实例_${session.pid}`)}</b></span>
        <span>${formatSessionTime(session.startedAt)}</span>
        <span>${formatSessionTime(session.endedAt, session.active)}</span>
        <span class="session-duration">${formatHistoryDuration(session.durationMs, true)}</span>
      </div>`).join('')
    : `<div class="history-empty">${icon('list')}<b>暂无会话</b><span>这里会列出最近 12 次启动</span></div>`;
}

async function loadHistory(range = currentHistoryRange, silent = false) {
  if (historyLoading) return;
  historyLoading = true;
  const result = await window.launcher.getHistory(range);
  historyLoading = false;
  if (result.ok) {
    lastHistoryRefresh = Date.now();
    renderHistory(result.data);
    if (!silent) setActivity(`已载入${({ day: '今日', week: '本周', month: '本月', total: '全部' })[range]}启动记录`);
  } else if (!silent) {
    setActivity('无法读取启动记录', result.error, 'error');
  }
}

function renderInstances(payload) {
  const instances = payload?.instances || [];
  $('#runningCount').textContent = instances.length;
  const list = $('#instanceList');
  if (!instances.length) {
    list.innerHTML = `<div class="empty-state">
      ${icon('monitor')}
      <b>启动游戏后将自动显示</b>
      <span>支持最多 4 个窗口实时监控</span>
    </div>`;
    return;
  }

  list.innerHTML = instances.slice(0, 4).map((item, index) => {
    const name = item.name || (index === 0 ? '主号' : `小号 ${index}`);
    const cpu = Math.max(0, Math.min(100, Number(item.cpuPercent) || 0));
    const memoryGb = Number(item.workingSetBytes || 0) / 1073741824;
    const memoryRatio = Math.max(2, Math.min(100, memoryGb / 8 * 100));
    const profile = presetForResolution(item.width, item.height, index);
    const resolution = item.width && item.height ? `${item.width} × ${item.height}` : '等待窗口';
    return `<article class="instance-card">
      <div class="instance-head"><i></i><b>${escapeHtml(name)}</b><span>运行中</span><code>PID ${item.pid}</code></div>
      <div class="instance-metrics">
        <div class="instance-metric"><small>窗口</small><strong>${resolution} · ${escapeHtml(fpsPresentation(profile).detail)}</strong></div>
        <div class="instance-metric"><small>CPU</small><strong>${cpu.toFixed(0)}%</strong><div class="usage"><i style="width:${Math.max(2,cpu)}%"></i></div></div>
        <div class="instance-metric"><small>内存</small><strong>${memoryGb.toFixed(1)} GB</strong><div class="usage"><i style="width:${memoryRatio}%"></i></div></div>
        <div class="instance-metric"><small>运行时长</small><strong>${formatDuration(item.runningSeconds)}</strong></div>
      </div>
    </article>`;
  }).join('');
}

async function refreshInstances(silent = true) {
  const result = await window.launcher.getInstances();
  if (result.ok) {
    renderInstances(result.data);
    if (currentView === 'history' && Date.now() - lastHistoryRefresh > 10000) {
      loadHistory(currentHistoryRange, true);
    }
    if (!silent) setActivity(`实例状态已刷新，共 ${result.data.instances.length} 个窗口`);
  } else if (!silent) {
    setActivity('无法读取实例状态', result.error, 'error');
  }
}

function setSwitchState(button, active, disabled = false) {
  if (!button) return;
  button.classList.toggle('active', Boolean(active));
  button.setAttribute('aria-pressed', String(Boolean(active)));
  button.disabled = disabled;
}

function formatPairingExpiry(timestamp) {
  if (!timestamp) return '服务开启后可配对';
  const remaining = Number(timestamp) - Date.now();
  if (remaining <= 0) return '配对码已过期，请刷新';
  return `有效至 ${new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })}`;
}

function formatDeviceSeen(timestamp) {
  const elapsed = Date.now() - Number(timestamp || 0);
  if (elapsed < 60 * 1000) return '刚刚访问';
  if (elapsed < 60 * 60 * 1000) return `${Math.floor(elapsed / 60000)} 分钟前访问`;
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function renderBackgroundState(state) {
  if (!state) return;
  backgroundState = state;
  const monitor = state.monitor || {};
  const server = state.server || {};
  setSwitchState($('#minimizeToTrayToggle'), state.minimizeToTray, backgroundLoading);
  setSwitchState($('#autoStartToggle'), state.autoStart, backgroundLoading);
  setSwitchState($('#lanEnabledToggle'), server.enabled, backgroundLoading);

  const intervalSeconds = Math.max(1, Math.round(Number(monitor.intervalMs || 15000) / 1000));
  $('#remoteGuardState').textContent = monitor.instanceCount
    ? `正在记录 ${monitor.instanceCount} 个实例`
    : '低功耗等待游戏';
  $('#remotePollMode').textContent = monitor.instanceCount
    ? `游戏运行 · 每 ${intervalSeconds} 秒`
    : `空闲等待 · 每 ${intervalSeconds} 秒`;
  $('#remoteRendererState').textContent = monitor.visible ? '前台使用中' : '已释放';
  $('#remoteClientCount').textContent = `${Number(server.clientCount || 0)} 个实时连接`;

  $('#remoteServerState').classList.toggle('online', Boolean(server.running));
  $('#remoteServerTitle').textContent = server.running ? '服务已开启' : '服务未开启';
  $('#remoteServerDetail').textContent = server.running
    ? `专用网络 · 端口 ${server.port} · 只读`
    : '开启后生成本机访问地址与临时配对码';
  $('#remoteUrl').textContent = server.url || '等待开启局域网服务';
  $('#copyRemoteUrl').disabled = !server.url;
  $('#openRemotePage').disabled = !server.running;
  $('#rotatePairingCode').disabled = !server.running;

  const code = String(server.pairingCode || '');
  $('#remotePairCode').textContent = code.length === 6
    ? `${code.slice(0, 3)} ${code.slice(3)}`
    : '--- ---';
  $('#remotePairCode').disabled = !server.running || code.length !== 6;
  $('#remotePairExpiry').textContent = formatPairingExpiry(server.pairingExpiresAt);
  $('#remoteQrCode').hidden = !state.qrDataUrl;
  $('#remoteQrPlaceholder').hidden = Boolean(state.qrDataUrl);
  if (state.qrDataUrl) $('#remoteQrCode').src = state.qrDataUrl;

  const devices = server.devices || [];
  $('#remoteDeviceCount').textContent = `${devices.length} 台`;
  $('#revokeAllDevices').disabled = !devices.length;
  $('#remoteDeviceList').innerHTML = devices.length
    ? devices.map(device => `<div class="remote-device">
      ${icon('phone')}
      <span><b>${escapeHtml(device.name)}</b><small>${escapeHtml(device.address || '局域网设备')} · ${formatDeviceSeen(device.lastSeenAt)}</small></span>
      <button data-revoke-device="${escapeHtml(device.id)}">撤销</button>
    </div>`).join('')
    : '<div class="remote-device-empty">还没有已授权设备</div>';
}

async function loadBackgroundState(silent = true) {
  if (backgroundLoading) return;
  backgroundLoading = true;
  try {
    const result = await window.launcher.getBackgroundState();
    renderBackgroundState(result);
    if (!silent) setActivity('后台与局域网状态已刷新');
  } catch (error) {
    if (!silent) setActivity('无法读取后台状态', error?.message || String(error), 'error');
  } finally {
    backgroundLoading = false;
    if (backgroundState) renderBackgroundState(backgroundState);
  }
}

async function updateBackgroundOption(key, value, label) {
  if (backgroundLoading) return;
  backgroundLoading = true;
  if (backgroundState) renderBackgroundState(backgroundState);
  try {
    const result = await window.launcher.setBackgroundOption(key, value);
    if (!result.ok) {
      setActivity(`${label}失败`, result.error, 'error');
      backgroundLoading = false;
      await loadBackgroundState(true);
      return;
    }
    renderBackgroundState(result.data);
    setActivity(`${label}已${value ? '开启' : '关闭'}`);
  } catch (error) {
    setActivity(`${label}失败`, error?.message || String(error), 'error');
  } finally {
    backgroundLoading = false;
    if (backgroundState) renderBackgroundState(backgroundState);
  }
}

async function applyPreset(preset, launch, button) {
  if (busy) return false;
  setBusy(true, button);
  setActivity(launch ? `正在应用 ${preset} 并启动…` : `正在应用 ${preset}…`);
  try {
    const result = await window.launcher.applyPreset(preset, launch);
    if (result.ok) {
      setActivity(launch ? `${preset} 已应用，游戏正在启动` : `${preset} 已应用`, result.text);
      setTimeout(() => refreshInstances(), 1600);
      return true;
    }
    setActivity('操作失败', result.error, 'error');
    return false;
  } catch (error) {
    setActivity('操作失败', error?.message || String(error), 'error');
    return false;
  } finally {
    setBusy(false, button);
  }
}

function confirmDialog(title, message, confirmText = '继续') {
  return new Promise(resolve => {
    const modal = $('#confirmModal');
    $('#modalTitle').textContent = title;
    $('#modalMessage').textContent = message;
    $('[data-result="confirm"]', modal).textContent = confirmText;
    modal.hidden = false;
    const close = value => {
      modal.hidden = true;
      buttons.forEach(button => button.removeEventListener('click', handler));
      resolve(value);
    };
    const handler = event => close(event.currentTarget.dataset.result === 'confirm');
    const buttons = $$('[data-result]', modal);
    buttons.forEach(button => button.addEventListener('click', handler));
  });
}

async function runMultiLaunch() {
  if (busy) return;
  const count = Number($('#idleCount').value);
  const mainPreset = $('#mainPreset').value;
  const idlePreset = $('#idlePreset').value;
  const waitSeconds = Number($('#waitSeconds').value);
  const mode = $('#multiMode').value;
  const accepted = await confirmDialog(
    '启动多开方案',
    `将启动 1 个主号（${mainPreset}）和 ${count} 个小号（${idlePreset}）。\n每个窗口之间将${mode === 'manual' ? '等待你确认' : `等待 ${waitSeconds} 秒`}。`,
    '开始启动'
  );
  if (!accepted) return;

  setBusy(true, $('#multiLaunchButton'));
  const sequence = [mainPreset, ...Array(count).fill(idlePreset)];
  for (let index = 0; index < sequence.length; index++) {
    setActivity(`正在启动窗口 ${index + 1}/${sequence.length} · ${sequence[index]}`);
    const result = await window.launcher.applyPreset(sequence[index], true);
    if (!result.ok) {
      setBusy(false);
      setActivity(`窗口 ${index + 1} 启动失败`, result.error, 'error');
      return;
    }
    if (index < sequence.length - 1) {
      if (mode === 'manual') {
        const next = await confirmDialog(
          `窗口 ${index + 1} 已启动`,
          `请确认当前窗口画质显示正确，再继续写入 ${sequence[index + 1]} 并启动下一个窗口。`
        );
        if (!next) {
          setBusy(false);
          setActivity('已停止后续多开', `已完成 ${index + 1}/${sequence.length} 个窗口`);
          return;
        }
      } else {
        for (let remaining = waitSeconds; remaining > 0; remaining--) {
          setActivity(`窗口 ${index + 1} 已启动，${remaining} 秒后继续`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }
  setBusy(false);
  setActivity(`多开完成，共启动 ${sequence.length} 个窗口`);
  setTimeout(() => refreshInstances(), 1800);
}

async function runTool(action, button) {
  const actions = {
    restoreLatest: ['正在恢复最近备份…', () => window.launcher.restoreLatest()],
    restoreFactory: ['正在恢复默认配置…', () => window.launcher.restoreFactory()],
    cleanBackups: ['正在清理普通备份…', () => window.launcher.cleanBackups()],
    openBackups: ['正在打开备份目录…', () => window.launcher.openBackups()],
    openLog: ['正在打开运行日志…', () => window.launcher.openLog()]
  };
  const config = actions[action];
  if (!config || busy) return;
  if (action.startsWith('restore') || action === 'cleanBackups') {
    const accepted = await confirmDialog(
      action === 'cleanBackups' ? '清理普通备份' : '恢复配置',
      action === 'cleanBackups' ? '将清理自动生成的普通备份，并保留默认恢复点。' : '配置文件将被替换，当前文件会先自动备份。',
      '确认执行'
    );
    if (!accepted) return;
  }
  setBusy(true, button);
  setActivity(config[0]);
  try {
    const result = await config[1]();
    result.ok ? setActivity('操作已完成', result.text || config[0]) : setActivity('操作失败', result.error, 'error');
  } catch (error) {
    setActivity('操作失败', error?.message || String(error), 'error');
  } finally {
    setBusy(false, button);
  }
}

function renderFpsTargetSelection() {
  $$('.fps-target').forEach(button => {
    const active = Number(button.dataset.fpsTarget) === selectedFpsTarget;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
  const route = selectedFpsTarget === 120 ? '120 · 官方原版' : `120 → ${selectedFpsTarget}`;
  $('#fpsRouteTarget').textContent = route;
  $('#fpsHeroRule').textContent = selectedFpsTarget === 120
    ? '配置选择 120 FPS → 游戏官方原始 120 FPS'
    : `配置选择 120 FPS → 游戏实际 ${selectedFpsTarget} FPS`;
  $('#fpsLaunchHint').textContent = selectedFpsTarget === 120
    ? '恢复后，“2K 120”等预设继续使用官方 120 FPS；25/60 FPS 预设保持原标签。'
    : `选择“2K 120”等预设时，将显示“配置 120 · 实际 ${selectedFpsTarget}”；25/60 FPS 预设保持原标签。`;
  $('#applyFpsUnlock').textContent = selectedFpsTarget === 120
    ? '恢复官方原版帧率逻辑'
    : `应用 ${selectedFpsTarget} FPS 接管并备份`;
}

function renderFpsStatus(status) {
  fpsStatus = status?.ok === false ? null : status;
  const stateBadge = $('#fpsStateBadge');
  const packageState = $('#fpsPackageState');
  stateBadge.className = 'fps-state-badge';
  packageState.className = 'fps-package-state';

  if (!fpsStatus) {
    const error = status?.error || '无法读取帧率包体状态';
    stateBadge.classList.add('error');
    stateBadge.querySelector('b').textContent = '包体不可用';
    packageState.classList.add('error');
    packageState.querySelector('strong').textContent = '当前包体无法安全修改';
    packageState.querySelector('p').textContent = error;
    $('#fpsCurrentState').textContent = '不可用';
    $('#fpsBaselineState').textContent = '未检测';
    $('#fpsBackupCount').textContent = '未检测';
    $('#fpsPackagePath').textContent = error;
    syncFpsActionAvailability();
    renderFpsTargetSelection();
    updatePreset($('#presetSelect').value);
    renderPlanRows();
    return;
  }

  const legacy = String(fpsStatus.state).startsWith('legacy-');
  const unknown = fpsStatus.state === 'unknown';
  const safe = fpsStatus.compatible && !unknown;
  if (!safe || fpsStatus.gameRunning || legacy) {
    stateBadge.classList.add(safe ? 'warning' : 'error');
  }
  stateBadge.querySelector('b').textContent = fpsStatus.gameRunning
    ? '游戏运行中 · 已锁定写入'
    : legacy
      ? '检测到旧版全局强制补丁'
      : safe
        ? `当前已识别 · ${fpsStatus.stateLabel}`
        : '包体版本或槽位不兼容';

  if (!safe) packageState.classList.add('error');
  packageState.querySelector('strong').textContent = safe ? '当前包体已识别' : '当前包体拒绝写入';
  packageState.querySelector('p').textContent = safe
    ? 'NXPK v3 · SettingManager 槽位匹配 · 槽外整包哈希通过'
    : '版本锁、目标槽或槽外整包哈希未通过';
  $('#fpsCurrentState').textContent = fpsStatus.stateLabel;
  $('#fpsBaselineState').textContent = fpsStatus.baselineReady
    ? '永久保留 · 官方初始原包'
    : '首次应用时自动创建';
  $('#fpsBaselineState').className = fpsStatus.baselineReady ? 'ok' : '';
  const transactionBackupCount = Number(
    fpsStatus.transactionBackupCount ??
    Math.max(0, Number(fpsStatus.backupCount || 0) - (fpsStatus.baselineReady ? 1 : 0))
  );
  $('#fpsBackupCount').textContent = fpsStatus.baselineReady
    ? transactionBackupCount === 1
      ? '1 份最新 + 1 份永久'
      : `${transactionBackupCount} 份事务 + 1 份永久`
    : `${transactionBackupCount} 份事务备份`;
  $('#fpsPackagePath').textContent = fpsStatus.packagePath;
  syncFpsActionAvailability();
  renderFpsTargetSelection();
  updatePreset($('#presetSelect').value);
  renderPlanRows();
}

async function loadFpsStatus(silent = false) {
  if (fpsStatusLoading) return;
  fpsStatusLoading = true;
  const refreshButton = $('#refreshFpsStatus');
  refreshButton?.classList.add('loading');
  syncFpsActionAvailability();
  try {
    const result = await window.launcher.getFpsStatus();
    renderFpsStatus(result.ok ? result.data : { ok: false, error: result.error });
    if (!silent) {
      result.ok
        ? setActivity('帧率包体状态已刷新', result.data.stateLabel)
        : setActivity('帧率包体状态不可用', result.error, 'error');
    }
  } catch (error) {
    const message = error?.message || String(error);
    renderFpsStatus({ ok: false, error: message });
    if (!silent) setActivity('帧率包体状态不可用', message, 'error');
  } finally {
    fpsStatusLoading = false;
    refreshButton?.classList.remove('loading');
    syncFpsActionAvailability();
  }
}

async function chooseFpsTarget(target) {
  selectedFpsTarget = target;
  renderFpsTargetSelection();
  await window.launcher.saveFpsTarget(target);
}

async function applySelectedFpsTarget(button) {
  if (busy || !fpsStatus) return;
  const restoring = selectedFpsTarget === 120;
  const accepted = await confirmDialog(
    restoring ? '恢复官方帧率逻辑' : `接管 120 FPS 档为 ${selectedFpsTarget} FPS`,
    restoring
      ? '启动器会先完整备份当前 NPK，再恢复官方原始槽位并校验整包 SHA-256。成功后只保留最新事务备份，官方初始还原点永久保留。请确认游戏已经完全退出。'
      : `只有原生 120 FPS 档会被替换为 ${selectedFpsTarget} FPS，25/30/40/50/60/90 保持原样。\n启动器会先创建完整 NPK 事务备份；成功后自动清理更早备份，官方初始还原点永久保留。`,
    restoring ? '备份并恢复' : '备份并应用'
  );
  if (!accepted) return;
  setBusy(true, button);
  setActivity(
    restoring ? '正在创建完整备份并恢复官方帧率…' : `正在创建完整备份并应用 ${selectedFpsTarget} FPS 接管…`,
    '正在处理约 323 MB 的游戏包，请保持启动器开启'
  );
  try {
    const result = restoring
      ? await window.launcher.restoreFpsUnlock()
      : await window.launcher.applyFpsUnlock(selectedFpsTarget);
    if (result.ok) {
      setActivity(restoring ? '官方帧率逻辑已恢复' : `120 FPS 档已接管为 ${selectedFpsTarget} FPS`, result.text);
    } else {
      setActivity('帧率补丁操作失败', result.error, 'error');
    }
    await loadFpsStatus(true);
  } catch (error) {
    setActivity('帧率补丁操作失败', error?.message || String(error), 'error');
    await loadFpsStatus(true);
  } finally {
    setBusy(false, button);
  }
}

async function cleanFpsTransactionBackups(button) {
  if (busy || !fpsStatus?.baselineReady) return;
  const transactionBackupCount = Number(fpsStatus.transactionBackupCount || 0);

  const accepted = await confirmDialog(
    '清理冗余帧率备份',
    transactionBackupCount > 0
      ? `将删除 ${transactionBackupCount} 份事务备份，仅保留经过 SHA-256 验证的官方初始还原点。\n该官方还原点不会被删除。`
      : '当前没有事务备份。启动器仍会重新验证官方初始还原点，且不会删除该还原点。',
    '确认清理'
  );
  if (!accepted) return;

  setBusy(true, button);
  setActivity('正在验证官方还原点并清理事务备份…');
  try {
    const result = await window.launcher.cleanFpsBackups();
    result.ok
      ? setActivity('冗余帧率备份已清理', result.text)
      : setActivity('帧率备份清理失败', result.error, 'error');
    await loadFpsStatus(true);
  } catch (error) {
    setActivity('帧率备份清理失败', error?.message || String(error), 'error');
    await loadFpsStatus(true);
  } finally {
    setBusy(false, button);
  }
}

function switchView(view) {
  currentView = view;
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  $('#launchView').classList.toggle('active', view === 'launch' || view === 'multi');
  $('#historyView').classList.toggle('active', view === 'history');
  $('#fpsView').classList.toggle('active', view === 'fps');
  $('#remoteView').classList.toggle('active', view === 'remote');
  $('#toolsView').classList.toggle('active', view === 'tools');
  $('.main').classList.toggle('history-mode', view === 'history');
  $('.main').classList.toggle('remote-mode', view === 'remote');
  const fpsMode = view === 'fps';
  $('#heroEyebrow').textContent = fpsMode ? 'LIFEAFTER · FRAME ROUTING' : 'LIFEAFTER · GRAPHICS';
  $('#heroTitle').textContent = fpsMode ? '只接管 120，其余档位照常' : '画质与实例，一处掌控';
  $('#heroDescription').textContent = fpsMode
    ? '保留原有低帧与中帧配置，仅将游戏的 120 FPS 档映射到新的高帧目标。'
    : '安全切换预设、稳定多开、实时观察每个窗口。';
  $('#chooseRootButton').hidden = fpsMode;
  $('#fpsTakeoverPill').hidden = !fpsMode;
  if (view === 'multi') {
    setTimeout(() => $('#plansCard').scrollIntoView({ behavior: 'smooth', block: 'center' }), 20);
  }
  if (view === 'history') loadHistory(currentHistoryRange, true);
  if (view === 'fps') loadFpsStatus(true);
  if (view === 'remote') loadBackgroundState(true);
}

async function initialize() {
  updatePreset('2K 120');
  renderPlanRows();
  const result = await window.launcher.init();
  if (!result.ok) {
    setActivity('本地后台连接失败', result.error, 'error');
    return;
  }
  $('#gameRoot').textContent = result.root || '点击选择游戏目录';
  $('#topStatus').textContent = result.root ? '游戏已就绪' : '等待配置';
  renderInstances(result.instances);
  renderBackgroundState(result.background);
  selectedFpsTarget = [120, 180, 240, 300].includes(Number(result.fpsTargetPreference))
    ? Number(result.fpsTargetPreference)
    : 180;
  renderFpsStatus(result.fpsStatus || { ok: false, error: '未返回帧率包体状态' });
  const match = String(result.summary || '').match(/当前档位：([^/]+)/);
  if (match && presets[match[1].trim()]) updatePreset(match[1].trim());
  setActivity(result.root ? '游戏环境检测通过，可以启动' : '请先选择游戏目录', result.summary);
  unsubscribeInstances = window.launcher.onInstancesUpdated?.(payload => {
    renderInstances(payload);
    const count = payload?.instances?.length || 0;
    $('#topStatus').textContent = count ? `后台记录中 · ${count} 个实例` : '游戏已就绪';
    if (currentView === 'history' && Date.now() - lastHistoryRefresh > 10000) {
      loadHistory(currentHistoryRange, true);
    }
    if (currentView === 'remote') loadBackgroundState(true);
  });
  unsubscribeBackground = window.launcher.onBackgroundUpdated?.(state => {
    renderBackgroundState(state);
  });
}

$$('.nav-item').forEach(item => item.addEventListener('click', () => switchView(item.dataset.view)));
$('#presetSelect').addEventListener('change', event => updatePreset(event.target.value));
$$('.quality-tabs button').forEach(button => button.addEventListener('click', () => updatePreset(button.dataset.preset)));
$('#mainPreset').addEventListener('change', renderPlanRows);
$('#idlePreset').addEventListener('change', renderPlanRows);
$('#idleCount').addEventListener('change', renderPlanRows);

$('#chooseRootButton').addEventListener('click', async () => {
  const result = await window.launcher.chooseGameRoot();
  if (result.ok) {
    $('#gameRoot').textContent = result.root;
    $('#topStatus').textContent = '游戏已就绪';
    setActivity('游戏目录已更新', result.root);
    await loadFpsStatus(true);
  } else if (!result.canceled) {
    setActivity('目录选择失败', result.error, 'error');
  }
});

$('#applyButton').addEventListener('click', event => applyPreset($('#presetSelect').value, false, event.currentTarget));
$('#applyLaunchButton').addEventListener('click', event => applyPreset($('#presetSelect').value, true, event.currentTarget));
$('#multiLaunchButton').addEventListener('click', runMultiLaunch);
$('#refreshInstances').addEventListener('click', () => refreshInstances(false));
$$('.range-tabs button').forEach(button => button.addEventListener('click', () => {
  currentHistoryRange = button.dataset.range;
  $$('.range-tabs button').forEach(item => item.classList.toggle('active', item === button));
  loadHistory(currentHistoryRange);
}));
$('#exportHistory').addEventListener('click', async () => {
  const result = await window.launcher.exportHistory(currentHistoryRange);
  if (result.ok) setActivity('启动记录已导出', result.path);
  else if (!result.canceled) setActivity('导出失败', result.error, 'error');
});
$('#openHistoryFolder').addEventListener('click', async () => {
  const result = await window.launcher.openHistoryFolder();
  result.ok ? setActivity('已打开记录目录') : setActivity('无法打开记录目录', result.error, 'error');
});

$('#minimizeToTrayToggle').addEventListener('click', () => {
  updateBackgroundOption(
    'minimizeToTray',
    !backgroundState?.minimizeToTray,
    '关闭窗口时收至托盘'
  );
});
$('#autoStartToggle').addEventListener('click', () => {
  updateBackgroundOption('autoStart', !backgroundState?.autoStart, '随系统静默启动');
});
$('#lanEnabledToggle').addEventListener('click', () => {
  updateBackgroundOption(
    'lanEnabled',
    !backgroundState?.server?.enabled,
    '局域网只读访问'
  );
});
$('#copyRemoteUrl').addEventListener('click', async () => {
  const url = backgroundState?.server?.url;
  if (!url) return;
  await window.launcher.copyText(url);
  setActivity('局域网访问地址已复制', url);
});
$('#remotePairCode').addEventListener('click', async () => {
  const code = String(backgroundState?.server?.pairingCode || '');
  if (!code) return;
  await window.launcher.copyText(code);
  setActivity('设备配对码已复制');
});
$('#rotatePairingCode').addEventListener('click', async () => {
  const result = await window.launcher.rotatePairingCode();
  if (result.ok) {
    renderBackgroundState(result.data);
    setActivity('已生成新的五分钟配对码');
  } else {
    setActivity('无法刷新配对码', result.error, 'error');
  }
});
$('#openRemotePage').addEventListener('click', async () => {
  const result = await window.launcher.openRemotePage();
  result.ok
    ? setActivity('已在默认浏览器打开远端状态页', result.url)
    : setActivity('无法打开远端状态页', result.error, 'error');
});
$('#remoteDeviceList').addEventListener('click', async event => {
  const button = event.target.closest('[data-revoke-device]');
  if (!button) return;
  const result = await window.launcher.revokeRemoteDevice(button.dataset.revokeDevice);
  if (result.ok) {
    renderBackgroundState(result.data);
    setActivity('远端设备授权已撤销');
  } else {
    setActivity('无法撤销设备授权', result.error, 'error');
  }
});
$('#revokeAllDevices').addEventListener('click', async () => {
  const accepted = await confirmDialog(
    '撤销全部远端设备？',
    '所有已配对浏览器都会立即断开。之后需要使用新的六位配对码重新连接。',
    '全部撤销'
  );
  if (!accepted) return;
  const result = await window.launcher.revokeAllRemoteDevices();
  if (result.ok) {
    renderBackgroundState(result.data);
    setActivity('所有远端设备授权已撤销');
  } else {
    setActivity('无法撤销设备授权', result.error, 'error');
  }
});

$('#readConfigButton').addEventListener('click', async () => {
  const result = await window.launcher.readSummary();
  result.ok ? setActivity('已读取当前配置', result.text) : setActivity('读取失败', result.error, 'error');
});

$$('.fps-target').forEach(button =>
  button.addEventListener('click', () => chooseFpsTarget(Number(button.dataset.fpsTarget))));
$('#refreshFpsStatus').addEventListener('click', () => loadFpsStatus(false));
$('#applyFpsUnlock').addEventListener('click', event => applySelectedFpsTarget(event.currentTarget));
$('#restoreFpsUnlock').addEventListener('click', async event => {
  if (!fpsStatus || fpsStatus.state === 'original') return;
  selectedFpsTarget = 120;
  renderFpsTargetSelection();
  await applySelectedFpsTarget(event.currentTarget);
});
$('#cleanFpsBackups').addEventListener('click', event =>
  cleanFpsTransactionBackups(event.currentTarget));
$('#openFpsBackups').addEventListener('click', async () => {
  const result = await window.launcher.openFpsBackups();
  result.ok
    ? setActivity('已打开帧率完整备份目录')
    : setActivity('无法打开帧率备份目录', result.error, 'error');
});

$$('.tool-tile[data-action]').forEach(button =>
  button.addEventListener('click', () => runTool(button.dataset.action, button)));

$('#applyTiaozi').addEventListener('click', async event => {
  if (busy) return;
  setBusy(true, event.currentTarget);
  try {
    const result = await window.launcher.setTiaozi(Number($('#tiaoziScale').value));
    result.ok ? setActivity('跳字缩放已更新', result.text) : setActivity('修改失败', result.error, 'error');
  } catch (error) {
    setActivity('修改失败', error?.message || String(error), 'error');
  } finally {
    setBusy(false, event.currentTarget);
  }
});

$('#activityDetails').addEventListener('click', () => confirmDialog('操作详情', lastDetail || '暂无详情', '知道了'));
$('#aboutButton').addEventListener('click', () => switchView('tools'));

window.addEventListener('beforeunload', () => {
  unsubscribeInstances?.();
  unsubscribeBackground?.();
});

initialize();
