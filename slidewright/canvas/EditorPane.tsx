// Slidewright canvas — source editor pane.
//
// Used by the v0.1f standalone web app to give the canvas a peer
// source surface (the VS Code webview doesn't need this — VS Code
// is the source editor). The pane is a controlled <textarea> wired
// to the host:
//   - source flows in via Host.subscribe
//   - keystrokes flow out via Host.setSource (re-renders the canvas)
//   - canvas-side clicks arrive via Host.onSelection and set the
//     textarea's selection range
//   - the textarea's caret position flows out via Host.setCursor
//     (drives the canvas's onCursorChange — active slide tracks
//     where the user is typing)
//
// The optional editor-pane methods on Host are guarded since not
// every host implements them. If a host omits them, the pane runs
// in read-only-ish mode (still reflects subscribe state, but edits
// don't propagate). This shouldn't come up in practice — the pane
// is rendered only by hosts that opt into it.

import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import type { Host } from './host.js';

export function EditorPane({
  host,
  height,
}: {
  host: Host;
  height?: number;
}): ReactElement {
  const [source, setSource] = useState<string>('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Source flows from host → textarea. Initial fire is synchronous,
  // so the textarea hydrates with the deck's content on first render.
  useEffect(() => {
    return host.subscribe(({ source: s }) => setSource(s));
  }, [host]);

  // Canvas-click → textarea selection. After setting the selection
  // we force the scroll position so the *start* of the range lands
  // near the top of the visible area, with a small breathing-room
  // gutter. The default browser auto-scroll on setSelectionRange is
  // "minimal" — it only nudges enough to bring the caret into view,
  // which puts the start at the bottom edge of the viewport when
  // we're scrolling down to it. Computing scrollTop from the line
  // count gives consistent positioning regardless of direction.
  useEffect(() => {
    if (!host.onSelection) return;
    return host.onSelection(({ start, end }) => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(start, end, 'backward');
      const before = ta.value.substring(0, start);
      const lineIndex = before.length - before.replace(/\n/g, '').length;
      const lineHeight = parseFloat(getComputedStyle(ta).lineHeight);
      if (Number.isFinite(lineHeight)) {
        ta.scrollTop = Math.max(0, lineIndex * lineHeight - lineHeight * 2);
      }
    });
  }, [host]);

  return (
    <textarea
      ref={taRef}
      className="sw-editor-pane"
      spellCheck={false}
      value={source}
      style={height != null ? { height: `${height}px` } : undefined}
      onChange={(e) => host.setSource?.(e.currentTarget.value)}
      onSelect={(e) => host.setCursor?.(e.currentTarget.selectionStart)}
    />
  );
}
