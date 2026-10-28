import { cloneElement, type ReactElement } from 'react';
import type { Component, SourceFile, Value } from '../runtime/ast.js';
import type { ComponentRegistry } from '../runtime/contract.js';
import type { DocumentSnapshot } from '../runtime/document.js';
import { buildDifferences, buildFrames } from '../runtime/builds.js';
import { slotFill, stringLit } from '../runtime/ast-builders.js';
import { resolveParsedDeck, type SlideAstData } from '../runtime/loader.js';
import type { Scope } from '../runtime/scope.js';
import type { BuildThumbnail } from './SlideStrip.js';

/** Render each subordinate preview independently. Only its owning slide is
 * resolved, rather than resolving the full deck once per thumbnail. */
export function buildPreviewSlides(snapshot: DocumentSnapshot, slides: ReactElement[], data: SlideAstData[],
  components: ComponentRegistry, scope: Scope, defaultValue?: (object: Component, property: string) => Value | undefined): { initial: ReactElement[]; builds: Map<number, BuildThumbnail[]> } {
  const initial = [...slides];
  const builds = new Map<number, BuildThumbnail[]>();
  let chapter: string | undefined;
  for (const [index, slide] of data.entries()) {
    const authoredChapter = slide.authoredComp.fills.find(fill => fill.name === 'chapter')?.value;
    if (authoredChapter?.kind === 'string') chapter = authoredChapter.value;
    let frames;
    try { frames = buildFrames(slide.authoredComp); } catch { continue; }
    if (frames.length === 1) continue;
    const previewSlide = chapter !== undefined && authoredChapter === undefined
      ? { ...slide.authoredComp, fills: [...slide.authoredComp.fills, slotFill('chapter', stringLit(chapter))] } : slide.authoredComp;
    const ast: SourceFile = { ...snapshot.ast, items: snapshot.ast.items.map(item => item.name === 'Deck'
      ? { ...item, fills: item.fills.map(fill => fill.name === 'slides'
        ? { ...fill, value: { kind: 'list', items: [previewSlide], span: fill.value.span } as Value } : fill) } : item) } as SourceFile;
    const render = (frameIndex: number): ReactElement | undefined => {
      const resolved = resolveParsedDeck({ source: snapshot.source, file: snapshot.file, components, scope,
        buildIndices: new Map([[0, frameIndex]]) }, { ast, diagnostics: [] }).slides[0];
      if (!resolved) return undefined;
      const inner = (resolved.props as { children?: ReactElement }).children;
      return inner ? cloneElement(resolved, undefined, cloneElement(inner, { idx: index + 1 } as Record<string, unknown>)) : resolved;
    };
    if (slide.buildIndex !== 0) initial[index] = render(0) ?? slides[index]!;
    builds.set(index, frames.slice(1).flatMap(frame => {
      const element = render(frame.index);
      if (!element) return [];
      let changes: ReturnType<typeof buildDifferences> = [];
      try { changes = buildDifferences(slide.authoredComp, frame.index, defaultValue); } catch { /* Invalid source has loader diagnostics. */ }
      const entering = changes.filter(change => change.entering).length;
      const exiting = changes.filter(change => change.exiting).length;
      const changed = changes.filter(change => !change.entering && !change.exiting).length;
      const summary = [entering ? `${entering} entering` : '', exiting ? `${exiting} exiting` : '', changed ? `${changed} changed` : ''].filter(Boolean).join(' · ');
      return [{ index: frame.index, label: frame.label, slide: element, summary }];
    }));
  }
  return { initial, builds };
}
