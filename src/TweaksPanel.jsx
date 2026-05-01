import { useEffect, useRef, useState } from 'react';
import { renderNotesMarkdown } from './notes-markdown.js';

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accentColor: '#0000FF',
  notesOverlay: false,
} /*EDITMODE-END*/;

const ACCENTS = [
  { name: 'blue',    color: '#0000FF' },
  { name: 'amber',   color: '#FFA500' },
  { name: 'cyan',    color: '#00BFFF' },
  { name: 'magenta', color: '#FF0080' },
  { name: 'lime',    color: '#7FFF00' },
  { name: 'red',     color: '#FF3333' },
  { name: 'purple',  color: '#B026FF' },
];

export function TweaksPanel({ notes }) {
  const [accentColor, setAccentColor] = useState(TWEAK_DEFAULTS.accentColor);
  const [notesOverlay, setNotesOverlay] = useState(TWEAK_DEFAULTS.notesOverlay);
  const [editMode, setEditMode] = useState(false);
  const [slideIdx, setSlideIdx] = useState(0);
  const popoutRef = useRef(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accentColor);
  }, [accentColor]);

  // Edit-mode protocol with the parent frame, plus speaker-notes index sync.
  useEffect(() => {
    const onMsg = (e) => {
      const d = e.data;
      if (!d) return;
      if (d.type === '__activate_edit_mode') setEditMode(true);
      if (d.type === '__deactivate_edit_mode') setEditMode(false);
      if (typeof d.slideIndexChanged === 'number') {
        setSlideIdx(d.slideIndexChanged);
        pushToPopout({ slideIndexChanged: d.slideIndexChanged });
      }
      if (d.type === 'notes-ready') {
        pushToPopout({ notes, slideIndexChanged: slideIdxRef.current });
      }
      if (d.type === 'notes-key') {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: d.key,
            code: d.code,
            bubbles: true,
            cancelable: true,
          })
        );
      }
    };
    window.addEventListener('message', onMsg);
    try {
      window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    } catch (e) {}
    return () => window.removeEventListener('message', onMsg);
    // notes is stable for the deck's lifetime; slideIdxRef tracks the latest index.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  // Mirror slideIdx into a ref so message-handler closures see the latest value.
  const slideIdxRef = useRef(0);
  useEffect(() => {
    slideIdxRef.current = slideIdx;
  }, [slideIdx]);

  // 'N' opens / focuses the speaker-notes popout. Capture phase so it runs
  // before deck-stage's keydown handler.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (
        t &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      )
        return;
      e.preventDefault();
      openNotesPopout();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  function pushToPopout(msg) {
    const w = popoutRef.current;
    if (w && !w.closed) {
      try {
        w.postMessage(msg, '*');
      } catch (e) {}
    }
  }

  function openNotesPopout() {
    if (popoutRef.current && !popoutRef.current.closed) {
      popoutRef.current.focus();
      return;
    }
    popoutRef.current = window.open(
      'notes.html',
      'notes-popout',
      'width=720,height=900,menubar=no,toolbar=no,location=no,status=no'
    );
  }

  function pickAccent(color) {
    setAccentColor(color);
    try {
      window.parent.postMessage(
        { type: '__edit_mode_set_keys', edits: { accentColor: color } },
        '*'
      );
    } catch (e) {}
  }

  function toggleNotesOverlay(on) {
    setNotesOverlay(on);
    try {
      window.parent.postMessage(
        { type: '__edit_mode_set_keys', edits: { notesOverlay: on } },
        '*'
      );
    } catch (e) {}
  }

  return (
    <>
      <div
        id="tweaks-panel"
        className={editMode ? 'open' : ''}
        style={editMode ? undefined : { display: 'none' }}
      >
        <h4>Tweaks</h4>
        <label>Accent color</label>
        <div className="swatches" id="accent-swatches">
          {ACCENTS.map((a) => (
            <div
              key={a.color}
              className={'swatch' + (accentColor === a.color ? ' active' : '')}
              style={{ background: a.color }}
              title={a.name}
              onClick={() => pickAccent(a.color)}
            />
          ))}
        </div>
        <label style={{ marginTop: 16 }}>
          <input
            type="checkbox"
            checked={notesOverlay}
            onChange={(e) => toggleNotesOverlay(e.target.checked)}
          />{' '}
          Show speaker notes overlay
        </label>
      </div>

      <div id="notes-overlay" className={notesOverlay ? 'open' : ''}>
        <div className="slide-num">
          SLIDE {String(slideIdx + 1).padStart(2, '0')} / {notes.length}
        </div>
        <div
          dangerouslySetInnerHTML={{
            __html: renderNotesMarkdown(notes[slideIdx] || ''),
          }}
        />
      </div>
    </>
  );
}
