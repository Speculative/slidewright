import { parse } from '../slidewright/runtime/parser.js';
import type { Component, Value } from '../slidewright/runtime/ast.js';

const field = (node: Component, name: string) => node.fills.find(fill => fill.name === name)?.value;
const text = (value: Value | undefined) => value?.kind === 'string' ? value.value : '';

/** Export every authored note, including notes for custom animation stages. */
export function exportSpeakerNotes(source: string, file: string): string {
  const parsed = parse(source, file);
  const deck = parsed.ast.items.find(item => item.name === 'Deck');
  if (!deck || parsed.diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    throw new Error('Fix source errors before exporting speaker notes.');
  }
  const slides = field(deck, 'slides');
  const sections = (slides?.kind === 'list' ? slides.items : []).map((slide, index) => {
    if (slide.kind !== 'component') return '';
    const label = text(field(slide, 'label'));
    const heading = `Slide ${index + 1}${label ? ` — ${label}` : ''}`;
    const notes = field(slide, 'notes');
    const body = notes?.kind === 'list'
      ? notes.items.map((note, step) => `Step ${step + 1}\n\n${text(note) || '(No speaker notes.)'}`).join('\n\n')
      : text(notes);
    return `${heading}\n\n${body || '(No speaker notes.)'}`;
  });
  return [text(field(deck, 'name')) || 'Speaker notes', ...sections].join('\n\n---\n\n') + '\n';
}
