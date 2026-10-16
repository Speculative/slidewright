// Contenteditable focus transitions can report a null relatedTarget. Let the
// browser finish moving focus before deciding whether the draft was left.
export function commitOnTextBlur(next: EventTarget | null, commit: () => void): void {
  const inside = (target: EventTarget | null) => target instanceof Element &&
    !!target.closest('.sw-text-session-actions, .sw-rich-text-editor, [data-sw-text-formatting]');
  if (next) { if (!inside(next)) commit(); }
  else queueMicrotask(() => { if (!inside(document.activeElement)) commit(); });
}
