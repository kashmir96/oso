// Light / dark theme toggle. Persisted in localStorage; applied via a
// data-theme attribute on <html> so :root variables can swap.

const KEY = 'ckf_theme';

export function getTheme() {
  return localStorage.getItem(KEY) || 'dark';
}

export function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') theme = 'dark';
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

export function applyTheme(theme = getTheme()) {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
  // Update the iOS status-bar tint via theme-color.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#ffffff' : '#0e0f12');
}
