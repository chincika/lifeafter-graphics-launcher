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
let historyEnabled = true;
let lastHistoryRefresh = 0;
let fpsStatus = null;
let selectedFpsTarget = 180;
let busyButton = null;
let fpsStatusLoading = false;
let backgroundState = null;
let backgroundLoading = false;
let updateState = null;
let performanceModeAvailable = false;
let performanceModeLoading = false;
let gameInstallations = { activeRoot: '', installations: [], scan: null };
let packageMenuOpen = false;
let packageScanLoading = false;
let unsubscribeInstances = null;
let unsubscribeBackground = null;
let unsubscribeUpdate = null;
let processSchedulingState = { topology: null, policies: {} };
let processSchedulingDraft = null;
let schedulingPreset = '';
let topologyDetailsOpen = false;
let processSchedulingSaving = false;
let processSchedulingSavePromise = null;

const processPriorityLabels = {
  idle: '低',
  belowNormal: '低于正常',
  normal: '正常',
  aboveNormal: '高于正常',
  high: '高'
};

const cpuModeLabels = {
  system: '系统管理',
  all: '全部核心',
  performance: '性能核心',
  efficiency: '能效核心',
  custom: '自定义'
};

const recommendedProcessPolicies = {
  '2K 120': { priority: 'high', cpuMode: 'all', cpuSetIds: [] },
  '1080p 120': { priority: 'high', cpuMode: 'all', cpuSetIds: [] },
  '1080p 60': { priority: 'normal', cpuMode: 'system', cpuSetIds: [] },
  '900p 120': { priority: 'high', cpuMode: 'all', cpuSetIds: [] },
  '900p 60': { priority: 'normal', cpuMode: 'system', cpuSetIds: [] },
  '720p 60': { priority: 'normal', cpuMode: 'system', cpuSetIds: [] },
  '540p 60': { priority: 'normal', cpuMode: 'system', cpuSetIds: [] },
  '540p 25': { priority: 'idle', cpuMode: 'efficiency', cpuSetIds: [] }
};

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

function cloneProcessPolicy(policy) {
  const source = policy || recommendedProcessPolicies['540p 60'];
  return {
    priority: source.priority,
    cpuMode: source.cpuMode,
    cpuSetIds: [...(source.cpuSetIds || [])]
  };
}

function processPolicyForPreset(preset) {
  const policy = processSchedulingState.policies?.[preset] ||
    recommendedProcessPolicies[preset] ||
    recommendedProcessPolicies['540p 60'];
  if (
    processSchedulingState.topology &&
    !processSchedulingState.topology.heterogeneous &&
    (policy.cpuMode === 'performance' || policy.cpuMode === 'efficiency')
  ) {
    return { ...policy, cpuMode: 'system' };
  }
  return policy;
}

function compactCpuModeLabel(mode) {
  if (mode === 'performance') return '性能核';
  if (mode === 'efficiency') return '能效核';
  if (mode === 'all') return '全核心';
  return cpuModeLabels[mode] || '系统管理';
}

function processPolicySummary(policy) {
  return `${processPriorityLabels[policy.priority] || '正常'} · ${compactCpuModeLabel(policy.cpuMode)}`;
}

function renderProcessSchedulingSummary() {
  const preset = $('#presetSelect')?.value || '2K 120';
  const summary = $('#schedulingSummary');
  if (summary) summary.textContent = `调度：${processPolicySummary(processPolicyForPreset(preset))}`;
}

function cpuSetsByType(type) {
  return (processSchedulingState.topology?.cpuSets || [])
    .filter(item => item.coreType === type);
}

function selectedCpuSetIds() {
  if (!processSchedulingDraft) return new Set();
  if (processSchedulingDraft.cpuMode === 'performance') {
    return new Set(cpuSetsByType('performance').map(item => Number(item.id)));
  }
  if (processSchedulingDraft.cpuMode === 'efficiency') {
    return new Set(cpuSetsByType('efficiency').map(item => Number(item.id)));
  }
  if (processSchedulingDraft.cpuMode === 'all') {
    return new Set((processSchedulingState.topology?.cpuSets || []).map(item => Number(item.id)));
  }
  if (processSchedulingDraft.cpuMode === 'custom') {
    return new Set((processSchedulingDraft.cpuSetIds || []).map(Number));
  }
  return new Set();
}

function coreCount(items) {
  return new Set(items.map(item => `${item.group}:${item.coreIndex}`)).size;
}

function logicalRange(items) {
  const values = items.map(item => Number(item.logicalProcessorIndex)).sort((a, b) => a - b);
  if (!values.length) return '无';
  const contiguous = values.every((value, index) => index === 0 || value === values[index - 1] + 1);
  return contiguous ? `CPU ${values[0]}–${values.at(-1)}` : `CPU ${values.join('、')}`;
}

function renderTopologyGroups() {
  const topology = processSchedulingState.topology;
  const container = $('#topologyGroups');
  const grid = $('#logicalProcessorGrid');
  if (!container || !grid) return;
  const cpuSets = topology?.cpuSets || [];
  const selected = selectedCpuSetIds();
  const groups = topology?.heterogeneous
    ? [
        { type: 'performance', label: '性能核心', code: 'P' },
        { type: 'efficiency', label: '能效核心', code: 'E' }
      ]
    : [{ type: 'uniform', label: '同构核心', code: 'C' }];

  container.innerHTML = groups.map(group => {
    const items = cpuSetsByType(group.type);
    if (!items.length) return '';
    const isSelected = items.some(item => selected.has(Number(item.id)));
    return `<div class="topology-group ${isSelected ? 'selected' : ''}">
      <i>${isSelected ? '✓' : ''}</i>
      <span><b>${group.label}</b><small>${group.code}0–${group.code}${Math.max(0, coreCount(items) - 1)} · ${logicalRange(items)}</small></span>
      <em>${coreCount(items)} 核心 · ${items.length} 线程</em>
    </div>`;
  }).join('');

  grid.hidden = !topologyDetailsOpen;
  grid.innerHTML = cpuSets.map(item => {
    const checked = selected.has(Number(item.id));
    const custom = processSchedulingDraft?.cpuMode === 'custom';
    return `<label class="logical-processor ${custom ? 'custom' : ''} ${checked ? 'selected' : ''}">
      ${custom ? `<input type="checkbox" data-cpu-set-id="${item.id}" ${checked ? 'checked' : ''}>` : ''}
      <span>G${item.group} · CPU ${item.logicalProcessorIndex}</span>
    </label>`;
  }).join('');

  $$('[data-cpu-set-id]', grid).forEach(input => {
    input.addEventListener('change', () => {
      const chosen = new Set(processSchedulingDraft.cpuSetIds.map(Number));
      const id = Number(input.dataset.cpuSetId);
      input.checked ? chosen.add(id) : chosen.delete(id);
      processSchedulingDraft.cpuSetIds = [...chosen].sort((a, b) => a - b);
      renderTopologyGroups();
    });
  });
}

function renderProcessSchedulingDrawer() {
  const topology = processSchedulingState.topology || {};
  const draft = processSchedulingDraft;
  if (!draft) return;
  $('#cpuModel').textContent = topology.model || '未能读取 CPU 型号';
  $('#cpuTopologySummary').textContent = topology.ok === false
    ? topology.error || 'CPU 拓扑识别失败'
    : `${topology.physicalCoreCount || 0} 核心 · ${topology.logicalProcessorCount || 0} 逻辑处理器 · ${topology.heterogeneous ? '混合架构' : '同构架构'}`;
  $$('#priorityOptions button').forEach(button => {
    button.classList.toggle('active', button.dataset.priority === draft.priority);
    button.disabled = processSchedulingSaving;
  });
  $$('#cpuModeOptions button').forEach(button => {
    const mode = button.dataset.cpuMode;
    button.classList.toggle('active', mode === draft.cpuMode);
    button.disabled = processSchedulingSaving || (
      (mode === 'performance' || mode === 'efficiency') &&
      (!topology.heterogeneous || !cpuSetsByType(mode).length)
    );
  });
  $('#saveProcessPolicy').disabled = processSchedulingSaving;
  $('#resetProcessPolicy').disabled = processSchedulingSaving;
  $('#saveProcessPolicy').textContent = processSchedulingSaving
    ? '正在保存…'
    : `保存到 ${schedulingPreset}`;
  $('#resetProcessPolicy').textContent = schedulingPreset === '540p 25'
    ? '恢复挂机推荐'
    : '恢复推荐';
  renderTopologyGroups();
}

function openProcessScheduling() {
  schedulingPreset = $('#presetSelect').value;
  processSchedulingDraft = cloneProcessPolicy(processPolicyForPreset(schedulingPreset));
  topologyDetailsOpen = false;
  $('#instancesPanel').hidden = true;
  $('#processSchedulingDrawer').hidden = false;
  $('#toggleTopologyDetails').classList.remove('open');
  renderProcessSchedulingDrawer();
}

function closeProcessScheduling() {
  $('#processSchedulingDrawer').hidden = true;
  $('#instancesPanel').hidden = false;
  processSchedulingDraft = null;
}

async function persistProcessPolicy({ closeDrawer = true, announce = true } = {}) {
  if (processSchedulingSaving) return processSchedulingSavePromise || false;
  if (!processSchedulingDraft || !schedulingPreset) return false;
  if (processSchedulingDraft.cpuMode === 'custom' && !processSchedulingDraft.cpuSetIds.length) {
    setActivity('请至少选择一个逻辑处理器', '自定义核心列表不能为空', 'error');
    return false;
  }
  const preset = schedulingPreset;
  const policy = cloneProcessPolicy(processSchedulingDraft);
  processSchedulingSaving = true;
  let resolvePendingSave;
  let saved = false;
  processSchedulingSavePromise = new Promise(resolve => { resolvePendingSave = resolve; });
  renderProcessSchedulingDrawer();
  try {
    const result = await window.launcher.saveProcessPolicy(preset, policy);
    if (!result.ok) {
      setActivity('进程调度保存失败', result.error, 'error');
      return false;
    }
    processSchedulingState.policies[preset] = cloneProcessPolicy(result.policy);
    if (schedulingPreset === preset) {
      processSchedulingDraft = cloneProcessPolicy(result.policy);
    }
    renderProcessSchedulingSummary();
    renderPlanRows();
    if (closeDrawer) closeProcessScheduling();
    if (announce) {
      setActivity(`${preset} 的进程调度已保存`, processPolicySummary(result.policy));
    }
    saved = true;
    return true;
  } catch (error) {
    setActivity('进程调度保存失败', error?.message || String(error), 'error');
    return false;
  } finally {
    processSchedulingSaving = false;
    resolvePendingSave(saved);
    processSchedulingSavePromise = null;
    if (!$('#processSchedulingDrawer').hidden && processSchedulingDraft) {
      renderProcessSchedulingDrawer();
    }
  }
}

async function saveProcessPolicy() {
  return persistProcessPolicy();
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

function renderHistoryRecordingState(enabled = historyEnabled) {
  historyEnabled = enabled !== false;
  const input = $('#historyEnabled');
  const label = $('#historyEnabledLabel');
  const badge = $('#historyRecordingBadge');
  if (input) input.checked = historyEnabled;
  if (label) label.textContent = historyEnabled ? '自动记录已开启' : '自动记录已暂停';
  if (badge) {
    badge.classList.toggle('paused', !historyEnabled);
    badge.lastChild.textContent = historyEnabled ? '自动记录' : '记录已暂停';
  }
}

function renderUpdateState(state) {
  if (!state) return;
  updateState = state;
  const busyPhases = new Set(['checking', 'downloading', 'installing']);
  const button = $('#checkForUpdates');
  const frequency = $('#updateFrequency');
  const currentVersion = state.currentVersion || '2.4.1';
  $('#aboutVersion').textContent = `v${currentVersion}`;
  $('#sidebarVersion').textContent = `v${currentVersion}`;
  $('#updateStatus').textContent = state.message || '尚未检查更新';
  $('#updateProgress').style.width = `${Math.max(0, Math.min(100, Number(state.progress) || 0))}%`;
  frequency.value = state.frequency || 'startup';
  frequency.disabled = busyPhases.has(state.phase);
  button.disabled = busyPhases.has(state.phase);
  button.classList.toggle('loading', busyPhases.has(state.phase));
  button.lastChild.textContent = state.phase === 'checking'
    ? '正在检查'
    : state.phase === 'downloading'
      ? `${Number(state.progress) || 0}%`
      : state.phase === 'installing'
        ? '正在重启'
        : '立即检查';
  const details = [];
  if (state.error) details.push(state.error);
  else if (state.lastCheckedAt) {
    details.push(`上次检查 ${new Date(state.lastCheckedAt).toLocaleString('zh-CN', { hour12: false })}`);
  } else {
    details.push('从 GitHub Release 获取并校验 Windows 便携版');
  }
  if (!state.automaticInstallSupported && state.phase === 'available') {
    details.push('当前运行方式不支持原位替换');
  }
  $('#updateDetail').textContent = details.join(' · ');
}

async function setUpdateFrequency(frequency) {
  const result = await window.launcher.setUpdateFrequency(frequency);
  if (result.ok) {
    renderUpdateState(result.data);
    const labels = {
      startup: '每次启动',
      daily: '每天一次',
      weekly: '每周一次',
      monthly: '每月一次'
    };
    setActivity('更新检查频率已调整', labels[frequency]);
  } else {
    renderUpdateState(updateState);
    setActivity('无法更新检查频率', result.error, 'error');
  }
}

async function checkForUpdatesNow() {
  renderUpdateState({
    ...(updateState || {}),
    phase: 'checking',
    progress: 0,
    message: '正在检查 GitHub 最新版本…',
    error: ''
  });
  try {
    const result = await window.launcher.checkForUpdates();
    if (result.data) renderUpdateState(result.data);
    if (!result.ok) {
      setActivity('检查更新失败', result.error, 'error');
    } else if (!result.updateAvailable) {
      setActivity('当前已是最新版本', result.data?.message || '');
    } else if (result.deferred) {
      setActivity('新版本已下载', '游戏退出后将自动替换并重启启动器。');
    } else {
      setActivity('发现新版本', result.data?.message || '正在准备更新');
    }
  } catch (error) {
    setActivity('检查更新失败', error?.message || String(error), 'error');
    const refreshed = await window.launcher.getUpdateState();
    if (refreshed.ok) renderUpdateState(refreshed.data);
  }
}

async function updateHistoryRecording(enabled) {
  const input = $('#historyEnabled');
  input.disabled = true;
  try {
    const result = await window.launcher.setHistoryEnabled(enabled);
    if (!result.ok) {
      renderHistoryRecordingState(!enabled);
      setActivity('无法更新启动记录设置', result.error, 'error');
      return;
    }
    renderHistoryRecordingState(result.value);
    setActivity(
      result.value ? '启动记录已开启' : '启动记录已暂停',
      result.value
        ? '之后检测到的游戏会话将继续保存在本机。'
        : '暂停期间仍会显示实例状态，但不会累计启动记录。'
    );
    await loadHistory(currentHistoryRange, true);
  } catch (error) {
    renderHistoryRecordingState(!enabled);
    setActivity('无法更新启动记录设置', error?.message || String(error), 'error');
  } finally {
    input.disabled = false;
  }
}

function formatLastUsed(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return '尚未使用';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function setPackageMenuOpen(open) {
  packageMenuOpen = Boolean(open);
  $('#packageMenu').hidden = !packageMenuOpen;
  $('#packageMenuBackdrop').hidden = !packageMenuOpen;
  $('#chooseRootButton').setAttribute('aria-expanded', String(packageMenuOpen));
}

function renderPackageScanState(scan = gameInstallations.scan) {
  const state = $('#packageScanState');
  state.classList.toggle('scanning', packageScanLoading);
  if (packageScanLoading) {
    state.querySelector('b').textContent = '正在扫描全部磁盘';
    state.querySelector('small').textContent = '只读取目录结构，不会修改任何游戏文件。';
    state.querySelector('time').textContent = '请稍候';
    return;
  }
  const drives = Array.isArray(scan?.drives)
    ? scan.drives.map(item => String(item).replace('\\', '')).join('、')
    : '';
  const count = gameInstallations.installations.filter(item => item.valid).length;
  state.querySelector('b').textContent = '自动检测已完成';
  state.querySelector('small').textContent = drives
    ? `已检查 ${drives}，当前记录 ${count} 个有效游戏包体`
    : `当前记录 ${count} 个有效游戏包体`;
  state.querySelector('time').textContent = scan?.completedAt ? '刚刚' : '已就绪';
}

function renderGameInstallations(payload = gameInstallations) {
  gameInstallations = payload || { activeRoot: '', installations: [], scan: null };
  const records = Array.isArray(gameInstallations.installations)
    ? gameInstallations.installations
    : [];
  const active = records.find(item => item.active) ||
    records.find(item => item.root === gameInstallations.activeRoot);
  $('#gameRoot').textContent = active?.root || gameInstallations.activeRoot || '点击添加游戏目录';
  $('#gamePlatformLabel').textContent = active?.platformLabel || '尚未选择';

  const list = $('#packageList');
  if (!records.length) {
    list.innerHTML = '<div class="package-empty">没有发现游戏包体<br><small>可以扫描磁盘或手动添加游戏目录</small></div>';
  } else {
    list.innerHTML = records.map((item, index) => {
      const caps = [
        item.valid ? '画质配置' : '目录已失效',
        item.performanceAvailable ? '性能 x64-3' : '标准启动',
        item.fpsAvailable ? '帧率可用' : '帧率待检测'
      ];
      const action = item.active
        ? '<button class="package-switch on" disabled>正在使用</button>'
        : item.valid
          ? `<button class="package-switch" data-switch-installation="${index}">切换到此包体</button>`
          : '<button class="package-switch" disabled>无法使用</button>';
      const remove = item.active
        ? ''
        : `<button class="package-remove" data-remove-installation="${index}">移除记录</button>`;
      return `
        <article class="package-installation ${item.platformId === 'fever' ? 'fever' : ''} ${item.active ? 'active' : ''} ${item.valid ? '' : 'invalid'}">
          <span class="package-installation-icon">${icon('folder')}</span>
          <div class="package-installation-info">
            <div class="package-installation-title">
              <b>${escapeHtml(item.platformLabel)}</b>
              <span class="package-badge">${item.platformId === 'fever' ? 'MRZH' : 'LIFEAFTER'}</span>
              ${item.active ? '<span class="package-current">当前使用</span>' : ''}
            </div>
            <p title="${escapeHtml(item.root)}">${escapeHtml(item.root)}</p>
            <div class="package-meta">
              <span>版本 <strong>${escapeHtml(item.version)}</strong></span>
              <span>${escapeHtml(item.sourceLabel)} · ${escapeHtml(item.folderHint)}</span>
              <span>最后使用 ${escapeHtml(formatLastUsed(item.lastUsedAt))}</span>
            </div>
            <div class="package-caps">${caps.map(value => `<span>${escapeHtml(value)}</span>`).join('')}</div>
          </div>
          <div class="package-installation-actions">${action}${remove}</div>
        </article>`;
    }).join('');
  }

  $$('[data-switch-installation]', list).forEach(button => {
    button.addEventListener('click', () =>
      switchGameInstallation(records[Number(button.dataset.switchInstallation)], button));
  });
  $$('[data-remove-installation]', list).forEach(button => {
    button.addEventListener('click', () =>
      removeGameInstallation(records[Number(button.dataset.removeInstallation)]));
  });
  renderPackageScanState();
}

function applyGameRootResult(result) {
  renderGameInstallations(result.installations);
  $('#gameRoot').textContent = result.root;
  $('#gamePlatformLabel').textContent =
    result.installation?.platformLabel || result.launchMode?.platformLabel || '游戏包体';
  $('#topStatus').textContent = '游戏已就绪';
  performanceModeAvailable = result.launchMode?.performanceAvailable === true;
  renderPerformanceMode();
  if (result.fpsStatus) renderFpsStatus(result.fpsStatus);
  const match = String(result.summary || '').match(/当前档位：([^/]+)/);
  if (match && presets[match[1].trim()]) updatePreset(match[1].trim());
}

async function addGameInstallation() {
  const result = await window.launcher.chooseGameRoot();
  if (result.ok) {
    applyGameRootResult(result);
    setPackageMenuOpen(false);
    setActivity(`已切换到${result.installation?.platformLabel || '游戏包体'}`, result.root);
  } else if (!result.canceled) {
    setActivity('目录添加失败', result.error, 'error');
  }
}

async function scanGameInstallations() {
  if (packageScanLoading) return;
  packageScanLoading = true;
  $('#scanGameRoots').disabled = true;
  renderPackageScanState();
  try {
    const result = await window.launcher.scanGameRoots();
    if (result.ok) {
      renderGameInstallations(result.data);
      const count = result.data.installations.filter(item => item.valid).length;
      setActivity('游戏包体扫描完成', `共记录 ${count} 个有效游戏包体`);
    } else {
      setActivity('游戏包体扫描失败', result.error, 'error');
    }
  } catch (error) {
    setActivity('游戏包体扫描失败', error?.message || String(error), 'error');
  } finally {
    packageScanLoading = false;
    $('#scanGameRoots').disabled = false;
    renderPackageScanState();
  }
}

async function switchGameInstallation(item, button) {
  if (!item?.valid || item.active) return;
  if (fpsStatus?.gameRunning) {
    setActivity('游戏运行中，暂时不能切换包体', '请完全退出游戏后再切换目录。', 'error');
    return;
  }
  button.disabled = true;
  button.textContent = '正在切换…';
  try {
    const result = await window.launcher.switchGameRoot(item.root);
    if (result.ok) {
      applyGameRootResult(result);
      setPackageMenuOpen(false);
      setActivity(`已切换到${result.installation.platformLabel}`, result.root);
    } else {
      setActivity('包体切换失败', result.error, 'error');
      renderGameInstallations(gameInstallations);
    }
  } catch (error) {
    setActivity('包体切换失败', error?.message || String(error), 'error');
    renderGameInstallations(gameInstallations);
  }
}

async function removeGameInstallation(item) {
  if (!item || item.active) return;
  const accepted = await confirmDialog(
    '移除目录记录？',
    `只会从启动器列表移除该记录，不会删除任何游戏文件。\n${item.root}`,
    '移除记录'
  );
  if (!accepted) return;
  const result = await window.launcher.removeGameRoot(item.root);
  if (result.ok) {
    renderGameInstallations(result.data);
    setActivity('目录记录已移除', item.root);
  } else {
    setActivity('无法移除目录记录', result.error, 'error');
  }
}

function formatPackageSize(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '未检测到';
  return value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(2)} GB`
    : `${(value / 1024 ** 2).toFixed(1)} MB`;
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
  renderProcessSchedulingSummary();
  if (!$('#processSchedulingDrawer')?.hidden) {
    schedulingPreset = value;
    processSchedulingDraft = cloneProcessPolicy(processPolicyForPreset(value));
    renderProcessSchedulingDrawer();
  }
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
    const scheduling = processPolicySummary(processPolicyForPreset(row.preset));
    return `<div class="plan-row">
      <span class="row-icon">${icon('monitor')}</span>
      <span class="plan-name"><b>${row.name}</b><small>${escapeHtml(row.preset)} · ${info.tone} · ${escapeHtml(scheduling)}</small></span>
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
    const scheduling = item.scheduling;
    const schedulingBadge = scheduling
      ? `<span class="instance-scheduling" title="${escapeHtml(scheduling.error || '')}">${escapeHtml(
          scheduling.ok === false ? '调度失败' : processPolicySummary(scheduling)
        )}</span>`
      : '';
    return `<article class="instance-card">
      <div class="instance-head"><i></i><b>${escapeHtml(name)}</b><span>运行中</span>${schedulingBadge}<code>PID ${item.pid}</code></div>
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
  if (
    launch &&
    processSchedulingDraft &&
    schedulingPreset === preset &&
    !$('#processSchedulingDrawer')?.hidden
  ) {
    const saved = await persistProcessPolicy({ closeDrawer: false, announce: false });
    if (!saved) return false;
  }
  setBusy(true, button);
  const performanceMode = launch && isPerformanceModeActive();
  setActivity(
    launch
      ? `正在应用 ${preset} 并以${performanceMode ? '性能' : '标准'}模式启动…`
      : `正在应用 ${preset}…`
  );
  try {
    const result = await window.launcher.applyPreset(preset, launch, performanceMode);
    if (result.ok) {
      setActivity(
        launch
          ? `${preset} 已应用，游戏正以${performanceMode ? '性能' : '标准'}模式启动`
          : `${preset} 已应用`,
        result.text
      );
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

function isPerformanceModeActive() {
  return performanceModeAvailable && $('#performanceMode').checked;
}

function renderPerformanceMode() {
  const checkbox = $('#performanceMode');
  const status = $('#performanceModeStatus');
  checkbox.disabled = performanceModeLoading || !performanceModeAvailable;
  if (!performanceModeAvailable) {
    status.textContent = '未找到 x64-3 性能通道';
    status.dataset.state = 'unavailable';
  } else if (checkbox.checked) {
    status.textContent = '性能通道 · x64-3';
    status.dataset.state = 'performance';
  } else {
    status.textContent = '标准通道 · 根目录';
    status.dataset.state = 'standard';
  }
}

async function updatePerformanceMode(enabled) {
  if (performanceModeLoading) return;
  performanceModeLoading = true;
  renderPerformanceMode();
  try {
    const result = await window.launcher.setPerformanceMode(enabled);
    if (!result.ok) {
      $('#performanceMode').checked = !enabled;
      setActivity('性能启动模式切换失败', result.error, 'error');
      return;
    }
    setActivity(
      enabled ? '性能启动模式已开启' : '已切换为标准启动模式',
      enabled
        ? '启动游戏时将使用官方 Documents\\bin\\x64-3\\lifeafter.exe 通道'
        : '启动游戏时将使用游戏根目录 lifeafter.exe'
    );
  } catch (error) {
    $('#performanceMode').checked = !enabled;
    setActivity('性能启动模式切换失败', error?.message || String(error), 'error');
  } finally {
    performanceModeLoading = false;
    renderPerformanceMode();
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
    const result = await window.launcher.applyPreset(
      sequence[index],
      true,
      isPerformanceModeActive()
    );
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
    $('#fpsPlatformLabel').textContent = '未识别';
    $('#fpsPlatformChip span').textContent = '游戏平台未识别';
    $('#fpsPlatformChip small').textContent = '写入已锁定';
    $('#fpsTargetPackageMeta').textContent = error;
    $('#fpsRootPackageMeta').textContent = '未执行根目录包体检测';
    $('#fpsCompatibilitySummary').textContent = '安全检查未通过，不会写入任何 NPK 文件。';
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
    ? `NXPK v3 · SettingManager 槽位匹配 · ${fpsStatus.compatibilityLabel || '兼容档案已建立'}`
    : '版本锁、目标槽或槽外整包哈希未通过';
  const platformLabel = fpsStatus.platformLabel || '老PC包体';
  const gameVersion = fpsStatus.gameVersion || '版本号未知';
  $('#fpsPlatformLabel').textContent = `${platformLabel} · ${gameVersion}`;
  $('#fpsPlatformChip span').textContent = platformLabel;
  $('#fpsPlatformChip small').textContent = fpsStatus.knownProfile ? '已验证档案' : '自动兼容档案';
  $('#fpsTargetPackageMeta').textContent =
    `${gameVersion} · ${formatPackageSize(fpsStatus.packageSize)} · 仅此文件可写`;
  $('#fpsRootPackageMeta').textContent = fpsStatus.rootPackagePresent
    ? `${formatPackageSize(fpsStatus.rootPackageSize)} · 已识别并保持只读`
    : '当前安装未检测到根目录完整包 · 无写入行为';
  $('#fpsCompatibilitySummary').textContent = fpsStatus.knownProfile
    ? `已命中 ${platformLabel} 的审核档案 ${String(fpsStatus.normalizedHash || '').slice(0, 16)}；更新后仍会重新校验。`
    : `包体整包哈希为新版本，但 NXPK 结构、SettingManager 元数据和槽位均与审核模型一致，已建立隔离档案 ${fpsStatus.profileId || ''}。`;
  $('#fpsCurrentState').textContent = fpsStatus.stateLabel;
  $('#fpsBaselineState').textContent = fpsStatus.baselineReady
    ? `永久保留 · ${platformLabel} 当前版本`
    : '首次应用时在启动器数据区创建';
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
  setPackageMenuOpen(false);
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
  processSchedulingState = result.processScheduling || processSchedulingState;
  renderProcessSchedulingSummary();
  renderPlanRows();
  $('#gameRoot').textContent = result.root || '点击选择游戏目录';
  renderGameInstallations(result.installations);
  $('#topStatus').textContent = result.root ? '游戏已就绪' : '等待配置';
  renderInstances(result.instances);
  renderHistoryRecordingState(result.historyEnabled);
  renderUpdateState(result.update);
  renderBackgroundState(result.background);
  performanceModeAvailable = result.launchMode?.performanceAvailable === true;
  $('#performanceMode').checked = result.performanceMode !== false;
  renderPerformanceMode();
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
  unsubscribeUpdate = window.launcher.onUpdateState?.(state => {
    renderUpdateState(state);
  });
}

$$('.nav-item').forEach(item => item.addEventListener('click', () => switchView(item.dataset.view)));
$('#presetSelect').addEventListener('change', event => updatePreset(event.target.value));
$$('.quality-tabs button').forEach(button => button.addEventListener('click', () => updatePreset(button.dataset.preset)));
$('#openProcessScheduling').addEventListener('click', openProcessScheduling);
$('#closeProcessScheduling').addEventListener('click', closeProcessScheduling);
$('#saveProcessPolicy').addEventListener('click', saveProcessPolicy);
$('#resetProcessPolicy').addEventListener('click', async () => {
  processSchedulingDraft = cloneProcessPolicy(
    recommendedProcessPolicies[schedulingPreset] || recommendedProcessPolicies['540p 60']
  );
  renderProcessSchedulingDrawer();
  await persistProcessPolicy({ closeDrawer: false });
});
$$('#priorityOptions button').forEach(button => {
  button.addEventListener('click', async () => {
    if (!processSchedulingDraft) return;
    processSchedulingDraft.priority = button.dataset.priority;
    renderProcessSchedulingDrawer();
    await persistProcessPolicy({ closeDrawer: false });
  });
});
$$('#cpuModeOptions button').forEach(button => {
  button.addEventListener('click', async () => {
    if (!processSchedulingDraft || button.disabled) return;
    const previouslySelected = [...selectedCpuSetIds()];
    processSchedulingDraft.cpuMode = button.dataset.cpuMode;
    if (processSchedulingDraft.cpuMode === 'custom' && !processSchedulingDraft.cpuSetIds.length) {
      processSchedulingDraft.cpuSetIds = previouslySelected.length
        ? previouslySelected
        : (processSchedulingState.topology?.cpuSets || []).map(item => Number(item.id));
    }
    renderProcessSchedulingDrawer();
    if (processSchedulingDraft.cpuMode !== 'custom') {
      await persistProcessPolicy({ closeDrawer: false });
    }
  });
});
$('#toggleTopologyDetails').addEventListener('click', event => {
  topologyDetailsOpen = !topologyDetailsOpen;
  event.currentTarget.classList.toggle('open', topologyDetailsOpen);
  renderTopologyGroups();
});
$('#mainPreset').addEventListener('change', renderPlanRows);
$('#idlePreset').addEventListener('change', renderPlanRows);
$('#idleCount').addEventListener('change', renderPlanRows);
$('#historyEnabled').addEventListener('change', event =>
  updateHistoryRecording(event.currentTarget.checked));
$('#updateFrequency').addEventListener('change', event =>
  setUpdateFrequency(event.currentTarget.value));
$('#checkForUpdates').addEventListener('click', checkForUpdatesNow);

$('#chooseRootButton').addEventListener('click', () => setPackageMenuOpen(!packageMenuOpen));
$('#packageMenuBackdrop').addEventListener('click', () => setPackageMenuOpen(false));
$('#addGameRoot').addEventListener('click', addGameInstallation);
$('#scanGameRoots').addEventListener('click', scanGameInstallations);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && packageMenuOpen) setPackageMenuOpen(false);
  if (event.key === 'Escape' && !$('#processSchedulingDrawer').hidden) {
    closeProcessScheduling();
  }
});

$('#applyButton').addEventListener('click', event => applyPreset($('#presetSelect').value, false, event.currentTarget));
$('#applyLaunchButton').addEventListener('click', event => applyPreset($('#presetSelect').value, true, event.currentTarget));
$('#performanceMode').addEventListener('change', event => updatePerformanceMode(event.currentTarget.checked));
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
    ? setActivity('已打开帧率事务备份目录')
    : setActivity('无法打开帧率备份目录', result.error, 'error');
});
$('#openFpsProtectedBackups').addEventListener('click', async () => {
  const result = await window.launcher.openFpsProtectedBackups();
  result.ok
    ? setActivity('已打开永久还原点目录')
    : setActivity('无法打开永久还原点目录', result.error, 'error');
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
  unsubscribeUpdate?.();
});

initialize();
