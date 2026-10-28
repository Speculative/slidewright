import type { ReactElement } from 'react';
import { buildFrames } from '../slidewright/runtime/builds.js';
import { loadDeck, type LoadDeckInput, type DeckMeta } from '../slidewright/runtime/loader.js';

export type PdfExportMode = 'final' | 'builds';
export interface PdfPage { slideIndex: number; buildIndex: number; slide: ReactElement }
export interface PdfDocument { meta: DeckMeta; slideCount: number; pages: PdfPage[] }

/** Resolve each page from canonical source, preserving deck scope and chapters.
 * No canvas state or source cursor participates in this projection. */
export function resolvePdfDocument(input: LoadDeckInput, mode: PdfExportMode): PdfDocument {
  const initial = loadDeck({ ...input, buildIndices: undefined });
  const errors = initial.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  if (errors.length) throw new Error('Fix source errors before exporting PDF.');
  if (!initial.slides.length) throw new Error('There are no slides to export.');
  const pages = initial.slidesData.flatMap((data, slideIndex) => {
    const count = buildFrames(data.authoredComp).length;
    const indices = mode === 'final' ? [count - 1] : Array.from({ length: count }, (_, index) => index);
    return indices.map(buildIndex => {
      const resolved = buildIndex === 0 ? initial : loadDeck({ ...input, buildIndices: new Map([[slideIndex, buildIndex]]) });
      if (resolved.diagnostics.some(diagnostic => diagnostic.severity === 'error')) throw new Error('Could not resolve a PDF build.');
      return { slideIndex, buildIndex, slide: resolved.slides[slideIndex]! };
    });
  });
  return { meta: initial.meta, slideCount: initial.slides.length, pages };
}
