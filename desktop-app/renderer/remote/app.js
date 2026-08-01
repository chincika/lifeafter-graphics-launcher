const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let eventSource = null;
let currentRange = 'day';
let lastSnapshotAt = 0;
let lastHistoryAt = 0;
let staleTimer = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatRuntime(totalSeconds) {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
}

function formatHistoryDuration(durationMs) {
  const totalMinutes = Math.max(0, Math.floor((Number(durationMs) || 0) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours) return `${hours}小时${minutes}分`;
  return `${minutes}分钟`;
}

function setConnection(kind, text) {
  const node = $('#connectionState');
  node.className = `connection ${kind || ''}`.trim();
  $('b', node).textContent = text;
}

function renderSnapshot(data) {
  lastSnapshotAt = Date.now();
  setConnection('', '本机在线');
  const instances = data?.instances || [];
  $('#instanceCount').textContent = instances.length;
  const totalMemory = instances.reduce((sum, item) => sum + Number(item.workingSetBytes || 0), 0);
  $('#overviewText').textContent = instances.length
    ? `后台记录正常 · 游戏内存 ${(totalMemory / 1073741824).toFixed(1)} GB`
    : '后台记录正常 · 等待游戏实例';
  $('#updatedAt').textContent = '刚刚更新';
  $('#instanceList').innerHTML = instances.length
    ? instances.map(item => {
      const resolution = item.width && item.height ? `${item.width} × ${item.height}` : '等待窗口';
      return `<article class="instance">
        <div class="instance-head"><i></i><b>${escapeHtml(item.name || `实例_${item.pid}`)}</b><code>PID ${item.pid}</code></div>
        <div class="metrics">
          <div><small>画面</small><strong>${resolution}</strong></div>
          <div><small>CPU</small><strong>${Number(item.cpuPercent || 0).toFixed(0)}%</strong></div>
          <div><small>内存</small><strong>${(Number(item.workingSetBytes || 0) / 1073741824).toFixed(1)} GB</strong></div>
          <div><small>运行时长</small><strong>${formatRuntime(item.runningSeconds)}</strong></div>
        </div>
      </article>`;
    }).join('')
    : '<div class="empty">游戏启动后，实例状态会自动出现在这里</div>';
}

function renderHistory(data) {
  $('#totalDuration').textContent = formatHistoryDuration(data.totalDurationMs);
  $('#launchCount').textContent = `${Number(data.launchCount || 0)} 次`;
  $('#accountCount').textContent = `${(data.accounts || []).length} 个账号`;
  $('#mostUsed').textContent = data.mostUsedAccount || '暂无';
  $('#mostUsedShare').textContent = data.totalDurationMs
    ? `占总时长 ${Math.round(Number(data.mostUsedShare || 0) * 100)}%`
    : '等待记录';
  $('#averageDuration').textContent = formatHistoryDuration(data.averageDurationMs);
  $('#historyGenerated').textContent = `更新于 ${new Date(data.generatedAt).toLocaleTimeString('zh-CN', { hour12: false })}`;

  const accounts = data.accounts || [];
  const maxDuration = Math.max(1, ...accounts.map(item => Number(item.durationMs) || 0));
  $('#ranking').innerHTML = accounts.length
    ? accounts.slice(0, 8).map((item, index) => `<div class="rank-row">
      <i>${index + 1}</i><b>${escapeHtml(item.account)}</b>
      <span class="track"><i style="width:${Math.max(3, item.durationMs / maxDuration * 100)}%"></i></span>
      <span>${formatHistoryDuration(item.durationMs)}</span>
    </div>`).join('')
    : '<div class="panel-empty">还没有账号记录</div>';

  const recent = data.recent || [];
  $('#recent').innerHTML = recent.length
    ? recent.slice(0, 8).map(item => `<div class="session-row">
      <b>${escapeHtml(item.account || `实例_${item.pid}`)}</b>
      <span>${new Date(item.startedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</span>
      <span>${item.active ? '进行中' : formatHistoryDuration(item.durationMs)}</span>
    </div>`).join('')
    : '<div class="panel-empty">还没有最近会话</div>';
}

async function api(path, options) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {})
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || '请求失败');
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function loadHistory(range = currentRange) {
  const result = await api(`/api/v1/history?range=${encodeURIComponent(range)}`);
  renderHistory(result.data);
  lastHistoryAt = Date.now();
}

function connectEvents() {
  eventSource?.close();
  eventSource = new EventSource('/api/v1/events');
  eventSource.addEventListener('snapshot', event => {
    renderSnapshot(JSON.parse(event.data));
    if (Date.now() - lastHistoryAt > 30000) {
      loadHistory(currentRange).catch(() => {});
    }
  });
  eventSource.addEventListener('heartbeat', () => {
    lastSnapshotAt = Date.now();
    setConnection('', '本机在线');
  });
  eventSource.onerror = () => setConnection('stale', '正在重连');
}

async function showDashboard() {
  $('#pairView').hidden = true;
  $('#dashboard').hidden = false;
  const [status] = await Promise.all([
    api('/api/v1/status'),
    loadHistory(currentRange)
  ]);
  renderSnapshot(status.data);
  connectEvents();
}

async function initialize() {
  try {
    const session = await api('/api/v1/session');
    if (session.authenticated) {
      await showDashboard();
    } else {
      $('#pairView').hidden = false;
      $('#dashboard').hidden = true;
      setConnection('stale', '等待配对');
    }
  } catch {
    setConnection('error', '无法连接');
  }
  staleTimer = setInterval(() => {
    if (!lastSnapshotAt || Date.now() - lastSnapshotAt <= 15000) return;
    setConnection('stale', '数据已暂停');
    $('#updatedAt').textContent = `停留在 ${new Date(lastSnapshotAt).toLocaleTimeString('zh-CN', { hour12: false })}`;
  }, 3000);
}

$('#pairForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('#pairError').textContent = '';
  const code = $('#pairCode').value.replace(/\D/g, '');
  if (code.length !== 6) {
    $('#pairError').textContent = '请输入六位配对码';
    return;
  }
  try {
    await api('/api/v1/pair', {
      method: 'POST',
      body: JSON.stringify({
        code,
        name: $('#deviceName').value.trim() || navigator.platform || '浏览器设备'
      })
    });
    await showDashboard();
  } catch (error) {
    $('#pairError').textContent = error.message;
  }
});

$('#pairCode').addEventListener('input', event => {
  const digits = event.target.value.replace(/\D/g, '').slice(0, 6);
  event.target.value = digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
});

$$('#rangeTabs button').forEach(button => button.addEventListener('click', async () => {
  currentRange = button.dataset.range;
  $$('#rangeTabs button').forEach(item => item.classList.toggle('active', item === button));
  try {
    await loadHistory(currentRange);
  } catch (error) {
    if (error.status === 401) location.reload();
  }
}));

window.addEventListener('beforeunload', () => {
  eventSource?.close();
  if (staleTimer) clearInterval(staleTimer);
});

initialize();
