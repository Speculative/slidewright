import { cloneElement, type ReactElement } from 'react';
import type { Component, SourceFile, Value } from '../slidewright/runtime/ast.js';
import { slotFill } from '../slidewright/runtime/ast-builders.js';
import { parse } from '../slidewright/runtime/parser.js';
import { resolveParsedDeck, type LoadDeckInput } from '../slidewright/runtime/loader.js';

/** A presenter session parses each source revision once and resolves only the
 * requested frames. Cached frames never cross source/asset revisions. */
export function createPresenterDeck(input: LoadDeckInput) {
  const parsed = parse(input.source, input.file);
  const deck = parsed.ast.items.find(item => item.name === 'Deck');
  const slidesFill = deck?.fills.find(fill => fill.name === 'slides');
  const slides = slidesFill?.value.kind === 'list' ? slidesFill.value.items : [];
  const project = (items: Value[]): SourceFile => ({ ...parsed.ast, items: parsed.ast.items.map(item => item === deck
    ? { ...item, fills: item.fills.map(fill => fill === slidesFill
      ? { ...fill, value: { ...slidesFill.value, kind: 'list', items } as Value } : fill) } : item) });
  const metadata = resolveParsedDeck(input, { ...parsed, ast: project([]) }).meta;
  const frames = new Map<string, ReactElement | null>();
  const chapters: (Value | undefined)[] = [];
  let chapter: Value | undefined;
  for (const slide of slides) {
    if (slide.kind === 'component' && slide.name === 'Slide') {
      chapter = slide.fills.find(fill => fill.name === 'chapter')?.value ?? chapter;
    }
    chapters.push(chapter);
  }
  return {
    meta: metadata,
    total: slides.length,
    authored(index: number): Component | undefined {
      const slide = slides[index];
      return slide?.kind === 'component' ? slide : undefined;
    },
    frame(index: number, buildIndex: number): ReactElement | null {
      const key = `${index}:${buildIndex}`;
      if (frames.has(key)) return frames.get(key)!;
      const slide = slides[index];
      if (!slide || slide.kind !== 'component') return null;
      const inherited = chapters[index];
      const projected = slide.name === 'Slide' && inherited && !slide.fills.some(fill => fill.name === 'chapter')
        ? { ...slide, fills: [...slide.fills, slotFill('chapter', inherited)] } : slide;
      const resolved = resolveParsedDeck({ ...input, buildIndices: new Map([[0, buildIndex]]) },
        { ...parsed, ast: project([projected]) }).slides[0];
      const inner = (resolved?.props as { children?: ReactElement } | undefined)?.children;
      const result = resolved && inner ? cloneElement(resolved, undefined,
        cloneElement(inner, { idx: index + 1 } as Record<string, unknown>)) : resolved ?? null;
      frames.set(key, result);
      return result;
    },
  };
}
