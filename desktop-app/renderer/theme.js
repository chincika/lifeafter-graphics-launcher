(() => {
  const key = 'launcher-ui-theme';
  let theme = 'light';
  try { theme = localStorage.getItem(key) === 'dark' ? 'dark' : 'light'; } catch {}
  document.documentElement.dataset.theme = theme;
  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.querySelector('#themeToggle');
    const drawer = document.querySelector('#processSchedulingDrawer');
    const backdrop = document.querySelector('#schedulingBackdrop');
    const close = document.querySelector('#closeProcessScheduling');
    function applyTheme(next) {
      theme = next;
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem(key, next); } catch {}
      const label = next === 'dark' ? '切换浅色主题' : '切换深色主题';
      toggle.setAttribute('aria-label', label);
      toggle.title = label;
      toggle.querySelector('span').textContent = next === 'dark' ? '浅色' : '深色';
      window.launcher?.setUiTheme?.(next);
    }
    toggle.addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));
    applyTheme(theme);
    let previousFocus = null;
    new MutationObserver(() => {
      backdrop.hidden = drawer.hidden;
      if (!drawer.hidden) {
        previousFocus = document.activeElement;
        close.focus({ preventScroll:true });
      } else if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll:true });
        previousFocus = null;
      }
    }).observe(drawer, { attributes:true, attributeFilter:['hidden'] });
    backdrop.addEventListener('click', () => close.click());
    document.addEventListener('click', event => {
      const nav = event.target.closest('[data-view]');
      if (nav && !['launch','multi'].includes(nav.dataset.view) && !drawer.hidden) close.click();
    });
    document.addEventListener('keydown', event => {
      if (drawer.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close.click();
      } else if (event.key === 'Tab') {
        const items = [...drawer.querySelectorAll('button,input,select,[tabindex]')].filter(el => !el.disabled && el.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
  });
})();
