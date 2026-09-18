/** Share shortcut-dialog visibility without registering additional keyboard listeners. */
export function useShortcuts() {
  const open = useState<boolean>('ezrepo.shortcuts.open', () => false);
  return { open };
}
