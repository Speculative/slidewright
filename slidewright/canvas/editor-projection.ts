// Projections exposed by the canvas to a co-located source editor.
//
// The Host always owns the complete deck source. These values describe
// which source-backed region the standalone editor should currently show;
// they are deliberately ranges rather than copied source documents.

import type { SourceRange } from './host.js';

export type EditorMode = 'deck' | 'slide' | 'notes';

export interface NotesProjection {
  // The raw source span of the notes value, including its quotes or
  // triple-quote delimiters. The notes editor projects the decoded value
  // and writes it back through this span.
  sourceRange: SourceRange;
  value: string;
  multiline: boolean;
  // An absent field projects an empty document at the slide's closing
  // brace. The first edit inserts a notes field at this position.
  insertField?: boolean;
}

export interface EditorPaneProjection {
  activeSlide: SourceRange | null;
  activeSlideIndex: number;
  totalSlides: number;
  notes: NotesProjection | null;
}
