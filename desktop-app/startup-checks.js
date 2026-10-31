// Every launch checks both channels. The preference controls only additional
// checks while the process remains running.
function startRequiredChecks({ showCached, checkNotices, checkUpdates, pollPolicy, getSettings, shouldCheck, intervalMs, schedule = setInterval }) {
  showCached();
  const noticeCheck = Promise.resolve().then(checkNotices).catch(() => {});
  const updateCheck = Promise.resolve().then(() => checkUpdates(noticeCheck)).catch(() => {});
  const timer = schedule(() => {
    Promise.resolve().then(pollPolicy).catch(() => {});
    const settings = getSettings();
    if (settings.updateFrequency !== 'startup' && shouldCheck(settings.updateFrequency, settings.lastUpdateCheckAt)) {
      Promise.resolve().then(() => checkUpdates(noticeCheck)).catch(() => {});
    }
  }, intervalMs);
  timer?.unref?.();
  return { noticeCheck, updateCheck, timer };
}

module.exports = { startRequiredChecks };
