import { describe, expect, it, vi } from 'vitest';

import { createShortcutBindings, globalShortcuts } from './shortcuts';

describe('global shortcuts', () => {
  it('registers exactly the documented combinations and invokes their matching actions', () => {
    const handlers = { search: vi.fn(), palette: vi.fn(), shortcuts: vi.fn() };
    const bindings = createShortcutBindings(handlers);
    expect(Object.keys(bindings)).toEqual(['/', 'meta_k', '?']);
    for (const shortcut of globalShortcuts) {
      bindings[shortcut.keys.join('_')]!();
      expect(handlers[shortcut.id]).toHaveBeenCalledTimes(1);
    }
  });
});
