// Projections exposed by the canvas to a co-located source editor.
//
// The Host always owns the complete deck source. These values describe
// which source-backed region the standalone editor should currently show;
// they are deliberately ranges rather than copied source documents.

import type { Component } from '../runtime/ast.js';
import { buildFrames, buildNotes } from '../runtime/builds.js';
import type { SourceRange } from './host.js';

export type EditorMode = 'deck' | 'slide' | 'notes';

export interface NotesProjection {
  // The raw source span of the notes value, including its quotes or
  // triple-quote delimiters. The notes editor projects the decoded value
  // and writes it back through this span.
  contextKey?: string;
  // A shared string or short array becomes a complete array on first edit.
  materialize?: { values: string[]; index: number };
  sourceRange: SourceRange;
  value: string;
  multiline: boolean;
  // An absent field projects an empty document at the slide's closing
  // brace. The first edit inserts a notes field at this position.
  insertField?: boolean;
}

export interface EditorPaneProjection {
  // Source snapshot owning every range in this projection.
  source: string;
  activeSlide: SourceRange | null;
  activeSlideIndex: number;
  totalSlides: number;
  notes: NotesProjection | null;
}


export function projectBuildNotes(slide: Component, slideIndex: number, buildIndex: number): NotesProjection | null {
  const notes = slide.fills.find(fill => fill.name === 'notes')?.value;
  const selected = notes?.kind === 'list' ? notes.items[buildIndex] : notes;
  if (notes && notes.kind !== 'string' && notes.kind !== 'list') return null;
  if (selected && selected.kind !== 'string') return null;
  let count = 1;
  try { count = buildFrames(slide).length; } catch { /* Render initial notes alongside build diagnostics. */ }
  const materialize = (notes?.kind !== 'list' && count > 1) ||
    (notes?.kind === 'list' && !selected);
  const target = materialize ? notes : selected;
  return {
    contextKey: `${slideIndex}:${buildIndex}`,
    sourceRange: target
      ? { start: target.span.start.offset, end: target.span.end.offset }
      : { start: slide.span.end.offset - 1, end: slide.span.end.offset - 1 },
    value: buildNotes(slide, buildIndex),
    multiline: selected?.kind === 'string' && selected.multiline,
    insertField: !notes,
    ...(materialize ? { materialize: {
      values: Array.from({ length: Math.max(count, notes?.kind === 'list' ? notes.items.length : 0) },
        (_, index) => buildNotes(slide, index)),
      index: buildIndex,
    } } : {}),
  };
}
