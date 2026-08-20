// Slidewright canvas — standalone source editor.
//
// CodeMirror owns the editable view and its text-level history. The Host
// still owns the complete deck source. Deck and active-slide modes project
// a source range into the editor; notes mode projects the decoded notes
// value and writes it back through the notes literal's source span.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { basicSetup, EditorView } from 'codemirror';
import { keymap } from '@codemirror/view';
import {
  EditorSelection,
  EditorState,
  type Extension,
} from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import {
  slidewrightHighlighting,
  slidewrightLanguage,
} from './sw-language.js';

import type { Host, SourceRange } from './host.js';
import type {
  EditorMode,
  EditorPaneProjection,
  NotesProjection,
} from './editor-projection.js';

interface DocumentProjection {
  mode: EditorMode;
  text: string;
  globalStart: number;
  globalEnd: number;
  notes: NotesProjection | null;
}

interface SelectionState {
  start: number;
  end: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isInside(range: SourceRange, outer: SourceRange): boolean {
  return range.start >= outer.start && range.end <= outer.end;
}

function makeDocumentProjection(
  source: string,
  requestedMode: EditorMode,
  projection: EditorPaneProjection,
): DocumentProjection {
  if (requestedMode === 'slide' && projection.activeSlide) {
    return {
      mode: 'slide',
      text: source.slice(
        projection.activeSlide.start,
        projection.activeSlide.end,
      ),
      globalStart: projection.activeSlide.start,
      globalEnd: projection.activeSlide.end,
      notes: null,
    };
  }
  if (requestedMode === 'notes' && projection.notes) {
    return {
      mode: 'notes',
      text: projection.notes.value,
      globalStart: projection.notes.sourceRange.start,
      globalEnd: projection.notes.sourceRange.end,
      notes: projection.notes,
    };
  }
  return {
    mode: 'deck',
    text: source,
    globalStart: 0,
    globalEnd: source.length,
    notes: null,
  };
}

function localToGlobal(
  selection: SelectionState,
  projection: DocumentProjection,
): SelectionState {
  if (projection.mode === 'notes') {
    // Notes are decoded strings, so escaped source characters do not have
    // a one-to-one offset mapping. The slide identity only needs the start
    // of the notes value; source selection-sync is handled by slide mode.
    return { start: projection.globalStart, end: projection.globalStart };
  }
  return {
    start: projection.globalStart + selection.start,
    end: projection.globalStart + selection.end,
  };
}

function encodeNotesValue(
  value: string,
  source: string,
  notes: NotesProjection,
): string {
  if (!notes.multiline && !value.includes('\n')) {
    return JSON.stringify(value);
  }

  const lineStart = source.lastIndexOf('\n', notes.sourceRange.start - 1) + 1;
  const linePrefix = source.slice(lineStart, notes.sourceRange.start);
  const indentation = /^[ \t]*/.exec(linePrefix)?.[0] ?? '';
  const body = value
    .split('\n')
    .map((line) => (line.length > 0 ? `${indentation}  ${line}` : ''))
    .join('\n');
  return `"""\n${body}\n${indentation}"""`;
}

function sourceFromDocument(
  document: string,
  source: string,
  projection: DocumentProjection,
): string {
  if (projection.mode === 'deck') return document;
  if (projection.mode === 'slide') {
    return (
      source.slice(0, projection.globalStart) +
      document +
      source.slice(projection.globalEnd)
    );
  }
  if (!projection.notes) return source;
  const encoded = encodeNotesValue(document, source, projection.notes);
  return (
    source.slice(0, projection.globalStart) +
    encoded +
    source.slice(projection.globalEnd)
  );
}

function selectionForGlobalRange(
  range: SourceRange,
  projection: DocumentProjection,
): SelectionState | null {
  if (projection.mode === 'notes') {
    if (!isInside(range, { start: projection.globalStart, end: projection.globalEnd })) {
      return null;
    }
    return { start: 0, end: projection.text.length };
  }
  if (!isInside(range, { start: projection.globalStart, end: projection.globalEnd })) {
    return null;
  }
  return {
    start: clamp(range.start - projection.globalStart, 0, projection.text.length),
    end: clamp(range.end - projection.globalStart, 0, projection.text.length),
  };
}

export function EditorPane({
  host,
  projection,
  height,
}: {
  host: Host;
  projection: EditorPaneProjection;
  height?: number;
}): ReactElement {
  const [hostSource, setHostSource] = useState<string>('');
  const [displayedSource, setDisplayedSource] = useState<string>('');
  const [mode, setMode] = useState<EditorMode>('deck');
  const [selection, setSelection] = useState<SelectionState>({ start: 0, end: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sourceRef = useRef<string>('');
  const modeRef = useRef<EditorMode>('deck');
  const projectionRef = useRef<EditorPaneProjection>(projection);
  const documentProjectionRef = useRef<DocumentProjection>({
    mode: 'deck',
    text: '',
    globalStart: 0,
    globalEnd: 0,
    notes: null,
  });
  const extensionsRef = useRef<Extension[]>([]);
  const pendingSelectionRef = useRef<SourceRange | null>(null);

  projectionRef.current = projection;

  const effectiveMode: EditorMode =
    mode === 'slide' && projection.activeSlide
      ? 'slide'
      : mode === 'notes' && projection.notes
        ? 'notes'
        : 'deck';

  const currentDocumentProjection = useMemo(
    () => makeDocumentProjection(hostSource, effectiveMode, projection),
    [hostSource, effectiveMode, projection],
  );

  modeRef.current = effectiveMode;

  // Host → editor source subscription. CodeMirror itself remains the
  // source of the current visible document; this state only tracks the
  // host's complete canonical source and drives projection updates.
  useEffect(() => {
    return host.subscribe(({ source }) => {
      sourceRef.current = source;
      setHostSource(source);
      setDisplayedSource(source);
    });
  }, [host]);

  // Create one EditorView for the lifetime of this pane. Host updates use
  // setState below so an external replacement becomes a clean history
  // barrier rather than a synthetic user edit.
  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return undefined;

    const initial = makeDocumentProjection(
      sourceRef.current,
      modeRef.current,
      projectionRef.current,
    );
    documentProjectionRef.current = initial;
    extensionsRef.current = [
      basicSetup,
      slidewrightLanguage.extension,
      slidewrightHighlighting,
      keymap.of([indentWithTab]),
      EditorView.editable.of(host.setSource != null),
      EditorView.updateListener.of((update) => {
        const viewProjection = documentProjectionRef.current;
        const main = update.state.selection.main;
        const nextSelection = {
          start: main.from,
          end: main.to,
        };
        const globalSelection = localToGlobal(nextSelection, viewProjection);
        setSelection(globalSelection);
        host.setCursor?.(globalSelection.start);

        if (!update.docChanged || host.setSource == null) return;
        const nextDocument = update.state.doc.toString();
        const nextSource = sourceFromDocument(
          nextDocument,
          sourceRef.current,
          viewProjection,
        );
        sourceRef.current = nextSource;
        setDisplayedSource(
          viewProjection.mode === 'deck' ? nextSource : nextDocument,
        );
        host.setSource(nextSource);
      }),
    ];

    const view = new EditorView({
      state: EditorState.create({
        doc: initial.text,
        extensions: extensionsRef.current,
      }),
      parent,
    });
    viewRef.current = view;
    setDisplayedSource(initial.text);
    setSelection(localToGlobal({ start: 0, end: 0 }, initial));

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [host]);

  // Host source, active slide, or projection mode changed. Reconcile the
  // visible document while retaining the full source in sourceRef. A
  // host-driven replacement resets CodeMirror history, which is the
  // editor-side equivalent of the canvas's external-edit barrier.
  useEffect(() => {
    const next = currentDocumentProjection;
    documentProjectionRef.current = next;
    const view = viewRef.current;
    if (!view) return;

    if (view.state.doc.toString() !== next.text) {
      const cursor = clamp(view.state.selection.main.from, 0, next.text.length);
      view.setState(
        EditorState.create({
          doc: next.text,
          selection: EditorSelection.cursor(cursor),
          extensions: extensionsRef.current,
        }),
      );
    }
    setDisplayedSource(next.text);

    const pending = pendingSelectionRef.current;
    if (pending) {
      pendingSelectionRef.current = null;
      const local = selectionForGlobalRange(pending, next);
      if (local) {
        view.focus();
        view.dispatch({
          selection: EditorSelection.range(local.start, local.end),
          effects: EditorView.scrollIntoView(local.start, { y: 'start' }),
        });
        setSelection(pending);
      }
    }
  }, [currentDocumentProjection]);

  // Canvas → editor source selection. If a scoped projection cannot show
  // the requested range, fall back to the full-deck projection so a canvas
  // click never silently loses its source target.
  useEffect(() => {
    if (!host.onSelection) return undefined;
    return host.onSelection((range) => {
      const view = viewRef.current;
      if (!view) return;
      const current = documentProjectionRef.current;
      const local = selectionForGlobalRange(range, current);
      if (!local) {
        pendingSelectionRef.current = range;
        if (modeRef.current !== 'deck') setMode('deck');
        return;
      }
      view.focus();
      view.dispatch({
        selection: EditorSelection.range(local.start, local.end),
        effects: EditorView.scrollIntoView(local.start, { y: 'start' }),
      });
      setSelection(range);
    });
  }, [host]);

  const chooseMode = (next: EditorMode): void => {
    if (next === 'slide' && !projection.activeSlide) return;
    if (next === 'notes' && !projection.notes) return;
    setMode(next);
  };

  return (
    <div
      className="sw-editor-pane"
      data-mode={effectiveMode}
      data-source={displayedSource}
      data-selection-start={selection.start}
      data-selection-end={selection.end}
      style={height != null ? { height: `${height}px` } : undefined}
    >
      <div className="sw-editor-toolbar" role="tablist" aria-label="Source view">
        <button
          type="button"
          role="tab"
          aria-selected={effectiveMode === 'deck'}
          data-editor-mode="deck"
          onClick={() => chooseMode('deck')}
        >
          Deck source
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={effectiveMode === 'slide'}
          data-editor-mode="slide"
          disabled={!projection.activeSlide}
          onClick={() => chooseMode('slide')}
        >
          Slide {projection.activeSlideIndex + 1}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={effectiveMode === 'notes'}
          data-editor-mode="notes"
          disabled={!projection.notes}
          onClick={() => chooseMode('notes')}
        >
          Notes
        </button>
      </div>
      <div ref={containerRef} className="sw-editor-view" />
    </div>
  );
}
