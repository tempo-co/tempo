/** Optional feedback for a committed touch selection, never a prerequisite for the action. */
export function selectionHaptic(pointerType: string): void {
  if (
    pointerType !== 'touch' ||
    typeof navigator.vibrate !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return;
  }

  try {
    navigator.vibrate(8);
  } catch {
    // Unsupported or restricted feedback must not interrupt the selection.
  }
}
