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

let instanceTimer = null;
let lastDetail = '';
let busy = false;
let currentView = 'launch';
let currentHistoryRange = 'week';
let historyLoading = false;
let lastHistoryRefresh = 0;

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

function setBusy(value, activeButton) {
  busy = value;
  $$('.button, .tool-tile, .row-run').forEach(button => button.disabled = value);
  if (activeButton) activeButton.classList.toggle('loading', value);
}

function updatePreset(value) {
  const preset = presets[value] || presets['2K 120'];
  $('#presetSelect').value = value;
  $('#resolutionLabel').textContent = preset.label;
  $('#fpsLabel').textContent = preset.fps;
  $('#resolutionValue').textContent = preset.resolution;
  $('#fpsValue').textContent = preset.fps;
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
      <span class="plan-meta">${info.fps}</span>
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
        <div class="instance-metric"><small>窗口</small><strong>${resolution} · ${profile.fps}</strong></div>
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

async function applyPreset(preset, launch, button) {
  if (busy) return false;
  setBusy(true, button);
  setActivity(launch ? `正在应用 ${preset} 并启动…` : `正在应用 ${preset}…`);
  const result = await window.launcher.applyPreset(preset, launch);
  setBusy(false, button);
  if (result.ok) {
    setActivity(launch ? `${preset} 已应用，游戏正在启动` : `${preset} 已应用`, result.text);
    setTimeout(() => refreshInstances(), 1600);
    return true;
  }
  setActivity('操作失败', result.error, 'error');
  return false;
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
  const result = await config[1]();
  setBusy(false, button);
  result.ok ? setActivity('操作已完成', result.text || config[0]) : setActivity('操作失败', result.error, 'error');
}

function switchView(view) {
  currentView = view;
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  $('#launchView').classList.toggle('active', view === 'launch' || view === 'multi');
  $('#historyView').classList.toggle('active', view === 'history');
  $('#toolsView').classList.toggle('active', view === 'tools');
  $('.main').classList.toggle('history-mode', view === 'history');
  if (view === 'multi') {
    setTimeout(() => $('#plansCard').scrollIntoView({ behavior: 'smooth', block: 'center' }), 20);
  }
  if (view === 'history') loadHistory(currentHistoryRange, true);
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
  const match = String(result.summary || '').match(/当前档位：([^/]+)/);
  if (match && presets[match[1].trim()]) updatePreset(match[1].trim());
  setActivity(result.root ? '游戏环境检测通过，可以启动' : '请先选择游戏目录', result.summary);
  instanceTimer = setInterval(() => refreshInstances(), 1400);
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
$('#readConfigButton').addEventListener('click', async () => {
  const result = await window.launcher.readSummary();
  result.ok ? setActivity('已读取当前配置', result.text) : setActivity('读取失败', result.error, 'error');
});

$$('.tool-tile[data-action]').forEach(button =>
  button.addEventListener('click', () => runTool(button.dataset.action, button)));

$('#applyTiaozi').addEventListener('click', async event => {
  if (busy) return;
  setBusy(true, event.currentTarget);
  const result = await window.launcher.setTiaozi(Number($('#tiaoziScale').value));
  setBusy(false, event.currentTarget);
  result.ok ? setActivity('跳字缩放已更新', result.text) : setActivity('修改失败', result.error, 'error');
});

$('#activityDetails').addEventListener('click', () => confirmDialog('操作详情', lastDetail || '暂无详情', '知道了'));
$('#aboutButton').addEventListener('click', () => switchView('tools'));

window.addEventListener('beforeunload', () => {
  if (instanceTimer) clearInterval(instanceTimer);
});

initialize();
