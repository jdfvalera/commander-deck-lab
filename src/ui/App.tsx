import { useState } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { AppProvider } from './state';
import { DecksPage } from './pages/DecksPage';
import { AboutPage } from './pages/AboutPage';
import { ComingSoon } from './pages/ComingSoon';
import { ManaPage } from './pages/ManaPage';
import { GoldfishPage } from './pages/GoldfishPage';

type Theme = 'system' | 'light' | 'dark';

function readTheme(): Theme {
  try {
    const t = localStorage.getItem('cdl-theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  try {
    localStorage.setItem('cdl-theme', t);
  } catch {
    // theme just won't be remembered
  }
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = readTheme();
    applyTheme(t);
    return t;
  });
  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
  const icon: Record<Theme, string> = { system: '◐', light: '☀', dark: '☾' };
  return (
    <button
      aria-label={`Theme: ${theme}. Switch to ${next[theme]}.`}
      title={`Theme: ${theme}`}
      onClick={() => {
        applyTheme(next[theme]);
        setTheme(next[theme]);
      }}
    >
      {icon[theme]}
    </button>
  );
}

const NAV = [
  ['/', 'Decks'],
  ['/goldfish', 'Goldfish'],
  ['/mana', 'Mana & Hands'],
  ['/matchups', 'Matchups'],
  ['/about', 'About'],
] as const;

export function App() {
  return (
    <AppProvider>
      <HashRouter>
        <header className="topbar">
          <NavLink to="/" className="brand">
            🐢 <span>Commander Deck Lab</span>
          </NavLink>
          <nav className="nav">
            {NAV.map(([to, label]) => (
              <NavLink key={to} to={to} end>
                {label}
              </NavLink>
            ))}
          </nav>
          <ThemeToggle />
        </header>
        <main>
          <Routes>
            <Route path="/" element={<DecksPage />} />
            <Route path="/goldfish" element={<GoldfishPage />} />
            <Route path="/mana" element={<ManaPage />} />
            <Route path="/matchups" element={<ComingSoon title="Matchup simulator" milestone="M4" />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="*" element={<DecksPage />} />
          </Routes>
        </main>
      </HashRouter>
    </AppProvider>
  );
}
