// Presentation runtime. Wraps a deck's slides and owns:
//   - active slide index (state, persisted to localStorage)
//   - keyboard navigation (←/→, PgUp/PgDn, Space, Home/End, R, 0–9)
//   - auto-scaling the 1920×1080 (or whatever) canvas to fit the viewport
//   - dynamic @page rule so browser Save-as-PDF yields one slide per page
//   - speaker-notes popout bridge (N opens notes.html and stays in sync)
//
// Per-deck content is composed with <Slide>/<Section> from ./Slide.jsx;
// <Presentation> walks those, injects the slide index + act metadata, and
// toggles which one is rendered as active.
import {
  cloneElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  DeckMetaContext,
  Section,
  flattenSlides,
} from './Slide.jsx';

const STORAGE_PREFIX = 'presentation:slide:';
const POPOUT_FEATURES =
  'width=720,height=900,menubar=no,toolbar=no,location=no,status=no';

export function Presentation({
  width = 1920,
  height = 1080,
  name = '',
  subtitle = '',
  setupLabel = 'Setup',
  notes = [],
  children,
}) {
  const slides = flattenSlides(children);
  const total = slides.length;
  const storageKey = STORAGE_PREFIX + (location.pathname || '/');

  const [index, setIndex] = useState(() => readStoredIndex(storageKey, total));
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // Re-clamp if the deck shrinks across HMR.
  useEffect(() => {
    if (total === 0) return;
    if (index >= total) setIndex(total - 1);
  }, [total, index]);

  // Persist index across reloads.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(index));
    } catch (e) {
      void e;
    }
  }, [index, storageKey]);

  // ── act metadata pass ────────────────────────────────────────────────
  // Walk slides once per render to derive (actLabel, actNum) for each, so
  // <Slide> doesn't need ACTS arrays or hand-numbered props.
  let actLabel = setupLabel;
  let actNum = null;
  let actCounter = 0;
  const perSlide = slides.map((child) => {
    if (child.type === Section) {
      actCounter += 1;
      actNum = actCounter;
      actLabel = child.props.actLabel || `Act ${actCounter}`;
    }
    return { actLabel, actNum };
  });

  // ── keyboard navigation ──────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (
        t &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const k = e.key;
      let handled = true;
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Spacebar') {
        setIndex((i) => Math.min(total - 1, i + 1));
      } else if (k === 'ArrowLeft' || k === 'PageUp') {
        setIndex((i) => Math.max(0, i - 1));
      } else if (k === 'Home') {
        setIndex(0);
      } else if (k === 'End') {
        setIndex(Math.max(0, total - 1));
      } else if (k === 'r' || k === 'R') {
        setIndex(0);
      } else if (/^[0-9]$/.test(k)) {
        const n = k === '0' ? 9 : parseInt(k, 10) - 1;
        if (n < total) setIndex(n);
      } else {
        handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  // ── document title from deck meta ────────────────────────────────────
  useEffect(() => {
    const parts = [name, subtitle].filter(Boolean);
    if (parts.length) document.title = parts.join(' · ');
  }, [name, subtitle]);

  // ── auto-scale canvas to viewport ────────────────────────────────────
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const s = Math.min(
        window.innerWidth / width,
        window.innerHeight / height
      );
      canvas.style.transform = `scale(${s})`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [width, height]);

  // ── @page rule for PDF print, sized to the canvas ───────────────────
  useEffect(() => {
    const id = 'presentation-print-page';
    let tag = document.getElementById(id);
    if (!tag) {
      tag = document.createElement('style');
      tag.id = id;
      document.head.appendChild(tag);
    }
    tag.textContent =
      `@page { size: ${width}px ${height}px; margin: 0; } ` +
      `@media print { html, body { margin: 0 !important; padding: 0 !important; background: none !important; overflow: visible !important; height: auto !important; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`;
  }, [width, height]);

  // ── speaker-notes popout bridge ──────────────────────────────────────
  const popoutRef = useRef(null);

  const openPopout = useCallback(() => {
    if (popoutRef.current && !popoutRef.current.closed) {
      popoutRef.current.focus();
      return;
    }
    popoutRef.current = window.open('notes.html', 'notes-popout', POPOUT_FEATURES);
  }, []);

  // N opens / focuses the popout.
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
      openPopout();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPopout]);

  // Respond to popout's "notes-ready" with current notes + index, and
  // re-dispatch any keys the popout forwards as keydowns on this window
  // so the navigation handler above sees them.
  useEffect(() => {
    const onMsg = (e) => {
      const d = e.data;
      if (!d) return;
      if (d.type === 'notes-ready') {
        const w = popoutRef.current;
        if (w && !w.closed) {
          try {
            w.postMessage(
              { notes, slideIndexChanged: indexRef.current },
              '*'
            );
          } catch (err) {
            void err;
          }
        }
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
    return () => window.removeEventListener('message', onMsg);
  }, [notes]);

  // Push slide changes to the popout if it's open.
  useEffect(() => {
    const w = popoutRef.current;
    if (!w || w.closed) return;
    try {
      w.postMessage({ slideIndexChanged: index }, '*');
    } catch (err) {
      void err;
    }
  }, [index]);

  return (
    <DeckMetaContext.Provider value={{ name, subtitle, total }}>
      <div className="presentation">
        <div
          ref={canvasRef}
          className="presentation-canvas"
          style={{
            width: `${width}px`,
            height: `${height}px`,
            ['--deck-design-w']: `${width}px`,
            ['--deck-design-h']: `${height}px`,
          }}
        >
          {slides.map((child, i) =>
            cloneElement(child, {
              idx: i + 1,
              actLabel: perSlide[i].actLabel,
              actNum: perSlide[i].actNum,
              active: i === index,
            })
          )}
        </div>
      </div>
    </DeckMetaContext.Provider>
  );
}

function readStoredIndex(key, total) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return 0;
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0 && (total === 0 || n < total)) return n;
  } catch (e) {
    void e;
  }
  return 0;
}
