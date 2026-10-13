// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import cardsJson from '../fixtures/scryfall/cards.json';
import comboSubset from '../fixtures/spellbook/combos-subset.json';
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
    vi.stubGlobal('fetch', (url: string) =>
      String(url).endsWith('combos.json')
        ? Promise.resolve(new Response(JSON.stringify(comboSubset)))
        : Promise.reject(new Error('network disabled in tests')),
    );

    const el = document.createElement('div');
    document.body.appendChild(el);
    await act(async () => createRoot(el).render(<App />));
    await until(() => el.textContent!.includes('Load example'));

    const btn = [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Load example'))!;
    await act(async () => btn.click());
    await until(() => el.textContent!.includes('Legal Commander deck'));

    expect(el.textContent).toContain('Revised (16 swaps)');
    expect(el.textContent).toContain('Damage = toughness');
    expect(el.textContent).toContain('What the simulator understands');
    expect(el.textContent).toMatch(/\d+ of \d+ cards are fully understood/);

    const row = [...el.querySelectorAll('.card-row')].find((b) => b.textContent!.includes('The Pride of Hull Clade'))! as HTMLButtonElement;
    await act(async () => row.click());
    const editor = el.querySelector('.editor')!;
    expect(editor.textContent).toContain('{2}{U}{U}: Until end of turn');
    expect(editor.textContent).toContain('Grants “draw = toughness”');

    // Custom effect: add one and see its sentence.
    const add = [...editor.querySelectorAll('button')].find((b) => b.textContent === '+ Custom effect')!;
    await act(async () => add.click());
    expect(el.querySelector('.editor')!.textContent).toContain('Activated (free): draw 1 card');
    const close = el.querySelector('.editor button[aria-label="Close"]') as HTMLButtonElement;
    await act(async () => close.click());

    // Combos panel loads the shipped database and lists results with Spellbook links.
    const find = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Find combos')!;
    await act(async () => find.click());
    await until(() => el.textContent!.includes('One card away'));
    expect(el.textContent).toContain('In your deck');
    expect(el.querySelector('a[href^="https://commanderspellbook.com/combo/"]') || el.textContent!.includes('No complete combos found')).toBeTruthy();

    // Mana & Hands for the saved example deck.
    const manaLink = [...el.querySelectorAll('a')].find((a) => a.textContent === 'Mana & Hands')!;
    await act(async () => manaLink.click());
    await until(() => el.textContent!.includes('Lands in your opening hand'));
    for (const h of ['Odds of drawing a card', 'Color sources', 'Mulligans', 'Hand sampler', 'Curve']) expect(el.textContent).toContain(h);
    expect(el.textContent).toContain('The Pride of Hull Clade: {2}{U}{U}');
    const hands = el.querySelector('input[type="number"][step="1000"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(hands, '300');
      hands.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const runBtn = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Run')!;
    await act(async () => runBtn.click());
    await until(() => el.textContent!.includes('keep the first 7'), 15000);
    expect(el.textContent).toContain('cast turn comes from the goldfish');
    expect(el.textContent).toContain('Mana available by turn');
  }, 30000);
});
