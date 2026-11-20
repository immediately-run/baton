// theme.tsx — light and dark (B-221 item 4): the system's setting through CSS custom
// properties, with a three-way override — system, light, dark — kept in `localStorage`, the
// only thing the dashboard stores there. The override is one attribute on the root element;
// the stylesheet does the rest.
import { useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';
export const THEME_KEY = 'baton-theme';
const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

/** The stored override; `system` when none, or when storage is unavailable. */
export function storedTheme(): Theme {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Apply `theme` to the page and keep it. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try {
    if (theme === 'system') window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // storage refused: the override lasts for this page only
  }
}

/** The footer's three-way choice. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  useEffect(() => applyTheme(theme), [theme]);
  return (
    <fieldset className="theme">
      <legend>Theme</legend>
      {THEMES.map((t) => (
        <label key={t} className={`theme-opt${theme === t ? ' on' : ''}`}>
          <input type="radio" name="baton-theme" value={t} checked={theme === t} onChange={() => setTheme(t)} />
          {t}
        </label>
      ))}
    </fieldset>
  );
}
