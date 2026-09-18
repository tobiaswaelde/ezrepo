/** Global shortcuts shared by the shell handlers and keyboard-shortcuts dialog. */
export const globalShortcuts = [
  { id: 'search', keys: ['/'], action: 'layout.search', scope: 'shortcuts.global' },
  { id: 'palette', keys: ['meta', 'k'], action: 'commandPalette.open', scope: 'shortcuts.global' },
  { id: 'shortcuts', keys: ['?'], action: 'shortcuts.toggle', scope: 'shortcuts.global' },
] as const;

/** Build Nuxt UI bindings directly from the displayed shortcut definitions. */
export function createShortcutBindings(
  handlers: Partial<Record<(typeof globalShortcuts)[number]['id'], () => void>>,
): Record<string, () => void> {
  return Object.fromEntries(
    globalShortcuts.flatMap((shortcut) => {
      const handler = handlers[shortcut.id];
      return handler ? [[shortcut.keys.join('_'), handler]] : [];
    }),
  );
}
