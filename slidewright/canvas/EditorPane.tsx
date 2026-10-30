import { Button } from './design-system/Controls.js';
// Slidewright canvas — standalone source editor.
//
// CodeMirror owns the editable view and its text-level history. The Host
// still owns the complete deck source. Deck and active-slide modes project
// a source range into the editor; notes mode projects the decoded notes
// value and writes it back through the notes literal's source span.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
} from '@codemirror/state';
import { sourceEditorSetup, hostSourceSync, hostSourceTransactions } from './source-editor.js';
import { projectedSourceChanges } from './editor-changes.js';
import { sourceChanges, type DocumentUpdate, type SourceChange } from '../runtime/document.js';
import { sourceFolding, hangingWrap } from './source-layout.js';
import { tokenize } from '../runtime/lexer.js';
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
  source: string;
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
      source,
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
      source,
      mode: 'notes',
      text: projection.notes.value,
      globalStart: projection.notes.sourceRange.start,
      globalEnd: projection.notes.sourceRange.end,
      notes: projection.notes,
    };
  }
  return {
    source,
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
  // Triple strings have no escaping and dedent away significant whitespace.
  // Use an escaped string whenever that syntax cannot preserve the draft.
  if ((!notes.multiline && !value.includes('\n')) || value.includes('"""')) {
    return JSON.stringify(value);
  }

  const lineStart = source.lastIndexOf('\n', notes.sourceRange.start - 1) + 1;
  const linePrefix = source.slice(lineStart, notes.sourceRange.start);
  const indentation = /^[ \t]*/.exec(linePrefix)?.[0] ?? '';
  const body = value
    .split('\n')
    .map((line) => (line.length > 0 ? `${indentation}  ${line}` : ''))
    .join('\n');
  const encoded = `"""\n${body}\n${indentation}"""`;
  return tokenize(encoded, '<notes>').tokens[0]?.value === value ? encoded : JSON.stringify(value);
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
  return notesDocumentEdit(document, source, projection)?.source ?? source;
}

function notesDocumentEdit(
  document: string,
  source: string,
  projection: DocumentProjection,
): { source: string; projection: DocumentProjection } | null {
  // Never apply a range to a different source revision.
  if (!projection.notes || source !== projection.source) return null;
  let start = projection.globalStart;
  let encoded: string;
  let nextSource: string;
  if (projection.notes.insertField) {
    if (!document || source[start] !== '}') return null;
    const lineStart = source.lastIndexOf('\n', projection.globalStart - 1) + 1;
    const indentation = /^[ \t]*/.exec(source.slice(lineStart, projection.globalStart))?.[0] ?? '';
    const before = source.slice(0, projection.globalStart).replace(/[ \t]+$/, '');
    const prefix = before + (before.endsWith('\n') ? '' : '\n') + `${indentation}  notes: `;
    start = prefix.length;
    encoded = JSON.stringify(document);
    nextSource = (
      prefix + encoded + `\n${indentation}` +
      source.slice(projection.globalEnd)
    );
  } else {
    encoded = encodeNotesValue(document, source, projection.notes);
    nextSource = source.slice(0, start) + encoded + source.slice(projection.globalEnd);
  }
  const end = start + encoded.length;
  return {
    source: nextSource,
    projection: {
      source: nextSource,
      mode: 'notes',
      text: document,
      globalStart: start,
      globalEnd: end,
      notes: { sourceRange: { start, end }, value: document, multiline: encoded.startsWith('"""') },
    },
  };
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
  const [displayedSource, setDisplayedSource] = useState<string>('');
  const [mode, setMode] = useState<EditorMode>('deck');
  const [selection, setSelection] = useState<SelectionState>({ start: 0, end: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sourceRef = useRef<string>('');
  const modeRef = useRef<EditorMode>('deck');
  const projectionRef = useRef<EditorPaneProjection>(projection);
  const documentProjectionRef = useRef<DocumentProjection>({
    source: '',
    mode: 'deck',
    text: '',
    globalStart: 0,
    globalEnd: 0,
    notes: null,
  });
  const undoRef = useRef(new Compartment());
  const hostUpdateRef = useRef<DocumentUpdate | undefined>(undefined);
  const extensionsRef = useRef<(mode: EditorMode) => Extension[]>(() => []);
  const pendingSelectionRef = useRef<SourceRange | null>(null);
  const pendingNotesRef = useRef<{
    document: string;
    projection: DocumentProjection;
  } | null>(null);
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushNotesRef = useRef<() => void>(() => {});

  const cancelPendingNotes = (): void => {
    if (notesTimerRef.current != null) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = null;
    pendingNotesRef.current = null;
  };
  flushNotesRef.current = () => {
    const pending = pendingNotesRef.current;
    cancelPendingNotes();
    if (!pending || !host.setSource) return;
    const edit = notesDocumentEdit(pending.document, sourceRef.current, pending.projection);
    if (!edit) return;
    // Advance the range before publishing: blur/another edit can run before
    // React has delivered the updated AST projection back to this pane.
    documentProjectionRef.current = edit.projection;
    sourceRef.current = edit.source;
    host.setSource(edit.source, { changes: sourceChanges(pending.projection.source, edit.source),
      origin: 'source-editor', baseRevision: host.document?.snapshot.revision });
  };

  projectionRef.current = projection;

  const effectiveMode: EditorMode =
    mode === 'slide' && projection.activeSlide
      ? 'slide'
      : mode === 'notes' && projection.notes
        ? 'notes'
        : 'deck';

  const currentDocumentProjection = useMemo(
    () => makeDocumentProjection(projection.source, effectiveMode, projection),
    [effectiveMode, projection],
  );

  modeRef.current = effectiveMode;

  // Track source authority synchronously; source-backed projections from
  // the canvas carry their own matching source snapshot.
  useEffect(() => {
    return host.subscribe(({ source, documentUpdate }) => {
      if (source !== sourceRef.current || documentUpdate?.replacement) hostUpdateRef.current = documentUpdate;
      // A replacement from outside this editor wins over any pending draft.
      // Our own flush clears the draft before notifying the host.
      if (source !== sourceRef.current || documentUpdate?.replacement) cancelPendingNotes();
      sourceRef.current = source;
      if (modeRef.current === 'deck') setDisplayedSource(source);
    });
  }, [host]);

  // Create one EditorView for the lifetime of this pane. Host updates use
  // mapped transactions below; the history compartment alone is reset
  // for incoming source edits so the existing history barrier survives.
  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return undefined;

    const initial = makeDocumentProjection(
      sourceRef.current,
      modeRef.current,
      projectionRef.current,
    );
    documentProjectionRef.current = initial;
    extensionsRef.current = (mode) => [
      sourceEditorSetup(undoRef.current),
      EditorView.lineWrapping,
      hangingWrap(mode !== 'notes'),
      ...(mode === 'notes' ? [] : [
        slidewrightLanguage.extension,
        slidewrightHighlighting,
        sourceFolding,
      ]),
      keymap.of([indentWithTab]),
      EditorView.editable.of(host.setSource != null),
      EditorView.domEventHandlers({
        blur: () => { flushNotesRef.current(); },
      }),
      EditorView.updateListener.of((update) => {
        if (update.transactions.some(transaction => transaction.annotation(hostSourceSync))) return;
        const viewProjection = documentProjectionRef.current;
        // Host authority can advance before React reconciles this view. Never
        // publish an edit or caret using a projection from that older source.
        if (viewProjection.source !== sourceRef.current) return;
        const main = update.state.selection.main;
        const nextSelection = {
          start: main.from,
          end: main.to,
        };
        const globalSelection = localToGlobal(nextSelection, viewProjection);
        if (update.selectionSet || update.docChanged) {
          setSelection(globalSelection);
          if (!update.docChanged) host.setCursor?.(globalSelection.start);
        }

        if (!update.docChanged || host.setSource == null) return;
        const nextDocument = update.state.doc.toString();
        if (viewProjection.mode === 'notes') {
          // Keep typing inside CodeMirror. Mapping and the host's full deck
          // reload happen once after a pause, or synchronously on exit.
          pendingNotesRef.current = { document: nextDocument, projection: viewProjection };
          if (notesTimerRef.current != null) clearTimeout(notesTimerRef.current);
          notesTimerRef.current = setTimeout(() => flushNotesRef.current(), 300);
          setDisplayedSource(nextDocument);
          return;
        }
        const nextSource = sourceFromDocument(
          nextDocument,
          sourceRef.current,
          viewProjection,
        );
        const changes: SourceChange[] = [];
        update.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
          changes.push({ start: viewProjection.globalStart + from, end: viewProjection.globalStart + to, insert: inserted.toString() });
        });
        documentProjectionRef.current = { ...viewProjection, source: nextSource, text: nextDocument,
          globalEnd: viewProjection.globalEnd + nextDocument.length - update.startState.doc.length };
        sourceRef.current = nextSource;
        setDisplayedSource(
          viewProjection.mode === 'deck' ? nextSource : nextDocument,
        );
        host.setSource(nextSource, { changes, origin: 'source-editor', baseRevision: host.document?.snapshot.revision });
        host.setCursor?.(globalSelection.start);
      }),
    ];

    const view = new EditorView({
      state: EditorState.create({
        doc: initial.text,
        extensions: extensionsRef.current(initial.mode),
      }),
      parent,
    });
    viewRef.current = view;
    setDisplayedSource(initial.text);
    setSelection(localToGlobal({ start: 0, end: 0 }, initial));

    return () => {
      flushNotesRef.current();
      view.destroy();
      viewRef.current = null;
    };
  }, [host]);

  useEffect(() => {
    const flush = (): void => flushNotesRef.current();
    window.addEventListener('pagehide', flush);
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Host source, active slide, or projection mode changed. Reconcile the
  // visible document while retaining the full source in sourceRef. A
  // host-driven edit resets CodeMirror history, which is the
  // editor-side equivalent of the canvas's external-edit barrier.
  useEffect(() => {
    const next = currentDocumentProjection;
    if (next.source !== sourceRef.current) return;
    // Same-source host notifications (for example, saving a browser draft)
    // must not replace the text still being typed in Notes.
    if (pendingNotesRef.current && next.mode === 'notes' &&
        next.globalStart === pendingNotesRef.current.projection.globalStart) return;
    flushNotesRef.current();
    const previous = documentProjectionRef.current;
    const update = hostUpdateRef.current;
    hostUpdateRef.current = undefined;
    documentProjectionRef.current = next;
    const view = viewRef.current;
    if (!view) return;

    if (previous.mode !== next.mode || (previous.mode !== 'deck' && previous.source === next.source &&
        (previous.globalStart !== next.globalStart || previous.globalEnd !== next.globalEnd))) {
      // Navigating to another projection is a new editing context.
      const cursor = clamp(view.state.selection.main.from, 0, next.text.length);
      view.setState(EditorState.create({ doc: next.text, selection: EditorSelection.cursor(cursor),
        extensions: extensionsRef.current(next.mode) }));
    } else if (view.state.doc.toString() !== next.text || update?.replacement) {
      const before = { ...previous, text: view.state.doc.toString() };
      const changes = projectedSourceChanges(before, next, update);
      for (const transaction of hostSourceTransactions(undoRef.current, changes)) view.dispatch(transaction);
    }
    setDisplayedSource(next.text);
    const mappedSelection = view.state.selection.main;
    setSelection(localToGlobal({ start: mappedSelection.from, end: mappedSelection.to }, next));

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
    flushNotesRef.current();
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
        <Button
          type="button"
          role="tab"
          aria-selected={effectiveMode === 'deck'}
          data-editor-mode="deck"
          onClick={() => chooseMode('deck')}
        >
          Deck source
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={effectiveMode === 'slide'}
          data-editor-mode="slide"
          disabled={!projection.activeSlide}
          onClick={() => chooseMode('slide')}
        >
          Slide {projection.activeSlideIndex + 1}
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={effectiveMode === 'notes'}
          data-editor-mode="notes"
          disabled={!projection.notes}
          onClick={() => chooseMode('notes')}
        >
          Notes
        </Button>
      </div>
      <div ref={containerRef} className="sw-editor-view" />
    </div>
  );
}
