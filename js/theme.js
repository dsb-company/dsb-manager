(() => {
  'use strict';

  const KEY = 'dsb.theme';
  const root = document.documentElement;
  const metaTheme = document.querySelector('meta[name="theme-color"]');

  function savedTheme() {
    try {
      const value = localStorage.getItem(KEY);
      if (value === 'light' || value === 'dark') return value;
    } catch (_) {}
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function themeIcon(theme) {
    return theme === 'dark'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.6 15.4A8.5 8.5 0 0 1 8.6 3.4 8.5 8.5 0 1 0 20.6 15.4Z"/></svg>';
  }

  function syncButtons(theme) {
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const next = theme === 'dark' ? 'claro' : 'escuro';
      button.innerHTML = themeIcon(theme);
      button.setAttribute('aria-label', `Ativar modo ${next}`);
      button.setAttribute('title', `Ativar modo ${next}`);
    });
  }

  function apply(theme, persist = false) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    if (metaTheme) metaTheme.setAttribute('content', theme === 'dark' ? '#0b1120' : '#101725');
    if (persist) {
      try { localStorage.setItem(KEY, theme); } catch (_) {}
    }
    syncButtons(theme);
  }

  apply(savedTheme());

  document.addEventListener('DOMContentLoaded', () => syncButtons(root.dataset.theme || 'light'));
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-toggle]');
    if (!button) return;
    apply((root.dataset.theme || 'light') === 'dark' ? 'light' : 'dark', true);
  });
})();
