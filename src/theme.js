const STORAGE_KEY = 'haskify_theme';

// Dark-mode header logo: 'ring' (light circle behind it), 'filter' (inverted colours) or 'none'
const LOGO_STYLE = 'ring';

export function getInitialTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setThemeAttributes(theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.logo = LOGO_STYLE;
}

export function applyTheme(theme) {
  setThemeAttributes(theme);
  localStorage.setItem(STORAGE_KEY, theme);
}
