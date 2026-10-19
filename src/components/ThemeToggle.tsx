import { Moon, Sun } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const dark = theme === 'dark';
  const label = t(dark ? 'Switch to light mode' : 'Switch to dark mode');

  return <button
    type="button"
    className="theme-toggle"
    aria-label={label}
    aria-pressed={dark}
    title={label}
    onClick={toggleTheme}
  >
    {dark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
    <span>{t(dark ? 'Light mode' : 'Dark mode')}</span>
  </button>;
}
