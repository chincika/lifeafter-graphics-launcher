const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const UPDATE_INTERVALS = Object.freeze({
  startup: 0,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000
});

function versionParts(value) {
  const match = String(value || '').trim().match(/v?(\d+)\.(\d+)\.(\d+)/i);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}

function isNewerVersion(candidate, current) {
  const left = versionParts(candidate);
  const right = versionParts(current);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

function shouldCheckForUpdates(frequency, lastCheckedAt, now = Date.now()) {
  const interval = UPDATE_INTERVALS[frequency] ?? UPDATE_INTERVALS.startup;
  if (interval === 0) return true;
  return now - Math.max(0, Number(lastCheckedAt) || 0) >= interval;
}

function selectPortableAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const version = String(release?.tag_name || '').replace(/^v/i, '');
  const exact = assets.find(asset =>
    asset?.name === `LifeAfter-Graphics-Launcher-${version}.exe`);
  return exact || assets.find(asset =>
    /^LifeAfter-Graphics-Launcher-.*\.exe$/i.test(String(asset?.name || '')));
}

function digestFromText(text, assetName) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*([a-f0-9]{64})\s+[* ]?(.+?)\s*$/i);
    if (match && path.basename(match[2]) === path.basename(assetName)) {
      return match[1].toUpperCase();
    }
  }
  return '';
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', chunk => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex').toUpperCase()));
  });
}

function cleanupUpdateCache(dataDir, currentVersion, now = Date.now()) {
  const updatesDir = path.join(dataDir, 'updates');
  const removed = [];
  let entries = [];
  try {
    entries = fs.readdirSync(updatesDir, { withFileTypes: true });
  } catch {
    return { removed };
  }
  for (const entry of entries) {
    const target = path.join(updatesDir, entry.name);
    try {
      if (entry.isDirectory()) {
        const match = entry.name.match(/^v(\d+\.\d+\.\d+)$/i);
        if (match && !isNewerVersion(match[1], currentVersion)) {
          fs.rmSync(target, { recursive: true, force: true });
          removed.push(target);
        }
        continue;
      }
      const stat = fs.statSync(target);
      const staleScript = /^apply-update-\d+\.ps1$/i.test(entry.name) &&
        now - stat.mtimeMs >= 5 * 60 * 1000;
      const stalePartial = /\.partial$/i.test(entry.name) &&
        now - stat.mtimeMs >= 24 * 60 * 60 * 1000;
      if (staleScript || stalePartial) {
        fs.unlinkSync(target);
        removed.push(target);
      }
    } catch {
    }
  }
  return { removed };
}

class UpdateService {
  constructor(options) {
    this.currentVersion = String(options.currentVersion || '0.0.0');
    this.repo = String(options.repo);
    this.dataDir = options.dataDir;
    this.fetch = options.fetchImpl || globalThis.fetch;
    this.onStateChanged = options.onStateChanged || (() => {});
    this.state = {
      phase: 'idle',
      currentVersion: this.currentVersion,
      latestVersion: '',
      progress: 0,
      message: '尚未检查更新',
      releaseUrl: '',
      downloadedPath: '',
      error: ''
    };
  }

  updateState(patch) {
    this.state = { ...this.state, ...patch };
    this.onStateChanged(this.publicState());
    return this.publicState();
  }

  publicState() {
    return { ...this.state };
  }

  async request(url, responseType = 'json') {
    const response = await this.fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `lifeafter-graphics-launcher/${this.currentVersion}`,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      redirect: 'follow'
    });
    if (!response.ok) {
      throw new Error(`GitHub 请求失败：HTTP ${response.status}`);
    }
    return responseType === 'text' ? response.text() : response.json();
  }

  async expectedDigest(release, asset) {
    const direct = String(asset?.digest || '').match(/^sha256:([a-f0-9]{64})$/i);
    if (direct) return direct[1].toUpperCase();
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const checksum = assets.find(item =>
      /^(SHA256SUMS\.txt|sha256sums\.txt)$/i.test(String(item?.name || '')) ||
      String(item?.name || '').toLocaleLowerCase('en-US') ===
        `${String(asset.name).toLocaleLowerCase('en-US')}.sha256`);
    if (!checksum?.browser_download_url) return '';
    const text = await this.request(checksum.browser_download_url, 'text');
    return digestFromText(text, asset.name);
  }

  async check() {
    this.updateState({
      phase: 'checking',
      progress: 0,
      message: '正在检查 GitHub 最新版本…',
      error: ''
    });
    try {
      const release = await this.request(
        `https://api.github.com/repos/${this.repo}/releases/latest`
      );
      const latestVersion = String(release.tag_name || release.name || '').replace(/^v/i, '');
      const releaseUrl = String(release.html_url || '');
      if (!latestVersion) throw new Error('GitHub Release 未提供有效版本号。');
      if (!isNewerVersion(latestVersion, this.currentVersion)) {
        return {
          ok: true,
          updateAvailable: false,
          release,
          state: this.updateState({
            phase: 'current',
            latestVersion,
            releaseUrl,
            progress: 100,
            message: `当前已是最新版本 v${this.currentVersion}`
          })
        };
      }
      const asset = selectPortableAsset(release);
      if (!asset?.browser_download_url) {
        throw new Error('最新 Release 中没有找到 Windows 便携版 EXE。');
      }
      const expectedDigest = await this.expectedDigest(release, asset);
      if (!expectedDigest) {
        throw new Error('最新 Release 缺少 SHA-256 校验信息，已拒绝自动下载。');
      }
      this.updateState({
        phase: 'available',
        latestVersion,
        releaseUrl,
        message: `发现新版本 v${latestVersion}`
      });
      return { ok: true, updateAvailable: true, release, asset, expectedDigest };
    } catch (error) {
      return {
        ok: false,
        error: error?.message || String(error),
        state: this.updateState({
          phase: 'error',
          message: '检查更新失败',
          error: error?.message || String(error)
        })
      };
    }
  }

  async download(asset, expectedDigest, latestVersion) {
    const updateDir = path.join(this.dataDir, 'updates', `v${latestVersion}`);
    fs.mkdirSync(updateDir, { recursive: true });
    const partialPath = path.join(updateDir, `${path.basename(asset.name)}.partial`);
    const finalPath = path.join(updateDir, path.basename(asset.name));
    const normalizedDigest = String(expectedDigest || '').toUpperCase();
    try {
      const existing = fs.statSync(finalPath);
      const expectedSize = Math.max(0, Number(asset.size) || 0);
      if ((!expectedSize || existing.size === expectedSize) &&
          await sha256File(finalPath) === normalizedDigest) {
        return {
          ok: true,
          path: finalPath,
          digest: normalizedDigest,
          reused: true,
          state: this.updateState({
            phase: 'downloaded',
            progress: 100,
            downloadedPath: finalPath,
            message: `v${latestVersion} 已下载并通过校验，直接继续安装`
          })
        };
      }
    } catch {
    }
    this.updateState({
      phase: 'downloading',
      progress: 0,
      message: `正在下载 v${latestVersion}…`,
      error: ''
    });
    try {
      const response = await this.fetch(asset.browser_download_url, {
        headers: {
          Accept: 'application/octet-stream',
          'User-Agent': `lifeafter-graphics-launcher/${this.currentVersion}`
        },
        redirect: 'follow'
      });
      if (!response.ok || !response.body) {
        throw new Error(`更新下载失败：HTTP ${response.status}`);
      }
      const total = Math.max(0, Number(asset.size) || Number(response.headers.get('content-length')) || 0);
      let received = 0;
      const hash = crypto.createHash('sha256');
      const source = Readable.fromWeb(response.body);
      source.on('data', chunk => {
        received += chunk.length;
        hash.update(chunk);
        const progress = total ? Math.min(99, Math.floor(received / total * 100)) : 0;
        if (progress !== this.state.progress) {
          this.updateState({ progress, message: `正在下载 v${latestVersion} · ${progress}%` });
        }
      });
      await pipeline(source, fs.createWriteStream(partialPath));
      if (total && received !== total) {
        throw new Error(`更新文件大小不完整：应为 ${total} 字节，实际 ${received} 字节。`);
      }
      const actualDigest = hash.digest('hex').toUpperCase();
      if (actualDigest !== normalizedDigest) {
        throw new Error('更新文件 SHA-256 校验失败，已拒绝安装。');
      }
      if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
      fs.renameSync(partialPath, finalPath);
      return {
        ok: true,
        path: finalPath,
        digest: actualDigest,
        state: this.updateState({
          phase: 'downloaded',
          progress: 100,
          downloadedPath: finalPath,
          message: `v${latestVersion} 下载完成并通过校验`
        })
      };
    } catch (error) {
      try {
        if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);
      } catch {
      }
      return {
        ok: false,
        error: error?.message || String(error),
        state: this.updateState({
          phase: 'error',
          message: '更新下载失败',
          error: error?.message || String(error)
        })
      };
    }
  }
}

function schedulePortableReplacement({
  downloadedPath,
  expectedDigest,
  portablePath,
  currentPid,
  scriptDir,
  spawnImpl = spawn
}) {
  if (process.platform !== 'win32') {
    return { ok: false, error: '自动替换目前只支持 Windows 便携版。' };
  }
  if (!downloadedPath || !portablePath ||
      !/^[A-F0-9]{64}$/i.test(String(expectedDigest || ''))) {
    return { ok: false, error: '当前不是可自动替换的 Windows 便携版。' };
  }
  const source = path.resolve(downloadedPath);
  const target = path.resolve(portablePath);
  const sourceIsFile = (() => {
    try { return fs.statSync(source).isFile(); } catch { return false; }
  })();
  const targetIsFile = (() => {
    try { return fs.statSync(target).isFile(); } catch { return false; }
  })();
  if (!sourceIsFile || !targetIsFile || path.extname(target).toLocaleLowerCase('en-US') !== '.exe') {
    return { ok: false, error: '找不到已下载更新或当前便携版路径。' };
  }
  fs.mkdirSync(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, `apply-update-${Date.now()}.ps1`);
  const resultPath = path.join(scriptDir, 'last-update-result.json');
  const logPath = path.join(scriptDir, 'update-install.log');
  const script = [
    'param([int]$ProcessId,[string]$Source,[string]$Target,[string]$ExpectedDigest,[string]$ResultPath,[string]$LogPath)',
    '$ErrorActionPreference = "Stop"',
    '$newFile = "$Target.update-new"',
    '$backup = "$Target.previous"',
    '$replaced = $false',
    '$succeeded = $false',
    'function Write-InstallResult([bool]$Success,[string]$Message) {',
    '  $json = @{ success = $Success; message = $Message; timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress',
    '  [System.IO.File]::WriteAllText($ResultPath,$json,[System.Text.UTF8Encoding]::new($false))',
    '}',
    'function Write-InstallLog([string]$Message) {',
    '  Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value ("[{0:O}] {1}" -f [DateTime]::UtcNow,$Message)',
    '}',
    'try {',
    '  try { Wait-Process -Id $ProcessId -Timeout 90 -ErrorAction SilentlyContinue } catch {}',
    '  if ((Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash -ne $ExpectedDigest) { throw "Downloaded update digest changed before installation." }',
    '  Copy-Item -LiteralPath $Source -Destination $newFile -Force',
    '  if ((Get-FileHash -LiteralPath $newFile -Algorithm SHA256).Hash -ne $ExpectedDigest) { throw "Copied update digest verification failed." }',
    '  $deadline = [DateTime]::UtcNow.AddSeconds(120)',
    '  while ($true) {',
    '    try {',
    '      if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }',
    '      Move-Item -LiteralPath $Target -Destination $backup -Force',
    '      break',
    '    } catch {',
    '      if ([DateTime]::UtcNow -ge $deadline) { throw }',
    '      Start-Sleep -Milliseconds 500',
    '    }',
    '  }',
    '  Move-Item -LiteralPath $newFile -Destination $Target -Force',
    '  $replaced = $true',
    '  $newProcess = Start-Process -FilePath $Target -PassThru',
    '  Start-Sleep -Seconds 5',
    '  if ($newProcess.HasExited -and $newProcess.ExitCode -ne 0) { throw "Updated launcher exited with code $($newProcess.ExitCode)." }',
    '  Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue',
    '  $succeeded = $true',
    '  Write-InstallResult $true "Update installed successfully."',
    '  Write-InstallLog "Update installed successfully: $Target"',
    '} catch {',
    '  $message = $_.Exception.Message',
    '  if ($replaced -and (Test-Path -LiteralPath $backup)) {',
    '    Remove-Item -LiteralPath $Target -Force -ErrorAction SilentlyContinue',
    '    Move-Item -LiteralPath $backup -Destination $Target -Force',
    '  } elseif (-not (Test-Path -LiteralPath $Target) -and (Test-Path -LiteralPath $backup)) {',
    '    Move-Item -LiteralPath $backup -Destination $Target -Force',
    '  }',
    '  Write-InstallResult $false $message',
    '  Write-InstallLog "Update failed: $message"',
    '  exit 1',
    '} finally {',
    '  Remove-Item -LiteralPath $newFile -Force -ErrorAction SilentlyContinue',
    '  if ($succeeded) {',
    '    Remove-Item -LiteralPath $Source -Force -ErrorAction SilentlyContinue',
    '    Get-ChildItem -LiteralPath (Split-Path -Parent $PSCommandPath) -Filter "apply-update-*.ps1" -File -ErrorAction SilentlyContinue |',
    '      Remove-Item -Force -ErrorAction SilentlyContinue',
    '  }',
    '  Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
    '}'
  ].join('\r\n');
  fs.writeFileSync(scriptPath, script, 'utf8');
  const child = spawnImpl('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    '-ProcessId', String(currentPid),
    '-Source', source,
    '-Target', target,
    '-ExpectedDigest', String(expectedDigest).toUpperCase(),
    '-ResultPath', resultPath,
    '-LogPath', logPath
  ], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore'
  });
  child.unref();
  return { ok: true, scriptPath, resultPath, logPath, target };
}

module.exports = {
  UPDATE_INTERVALS,
  UpdateService,
  cleanupUpdateCache,
  digestFromText,
  isNewerVersion,
  schedulePortableReplacement,
  selectPortableAsset,
  sha256File,
  shouldCheckForUpdates,
  versionParts
};
