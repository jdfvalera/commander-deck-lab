// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import cardsJson from '../fixtures/scryfall/cards.json';
import { idbCardCache } from '../src/data/cardCache';
import type { ScryfallCard } from '../src/data/types';
import { App } from '../src/ui/App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const until = async (fn: () => boolean, ms = 5000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('timed out');
    await act(() => new Promise((r) => setTimeout(r, 20)));
  }
};

describe('UI smoke', () => {
  it('loads the example deck, validates it, shows tags and opens the tag editor', async () => {
    // Pre-fill the card cache so no network is needed; fail loudly if Scryfall is called anyway.
    await idbCardCache.putMany(cardsJson as ScryfallCard[]);
    vi.stubGlobal('fetch', () => Promise.reject(new Error('network disabled in tests')));

    const el = document.createElement('div');
    document.body.appendChild(el);
    await act(async () => createRoot(el).render(<App />));
    await until(() => el.textContent!.includes('Load example'));

    const btn = [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Load example'))!;
    await act(async () => btn.click());
    await until(() => el.textContent!.includes('Legal Commander deck'));

    expect(el.textContent).toContain('Revised (16 swaps)');
    expect(el.textContent).toContain('Damage = toughness');
    expect(el.textContent).toContain('What the simulator doesn’t understand');

    const row = [...el.querySelectorAll('.card-row')].find((b) => b.textContent!.includes('The Pride of Hull Clade'))! as HTMLButtonElement;
    await act(async () => row.click());
    const editor = el.querySelector('.editor')!;
    expect(editor.textContent).toContain('{2}{U}{U}: Until end of turn');
    expect(editor.textContent).toContain('Grants “draw = toughness”');
  });
});
