import type { Value } from '../../runtime/ast.js';

// These are Slidewright coordinates, never editor-engine positions.
export type TextValuePath = ReadonlyArray<
  { kind: 'fill'; name: string } | { kind: 'item'; index: number }
>;

export interface TextOrigin {
  id: string;
  value: Value;
  path: TextValuePath;
}

export interface TextPoint {
  nodeId: string;
  // UTF-16, matching DOM offsets. Navigation commands must respect
  // grapheme boundaries rather than splitting surrogate pairs/clusters.
  offset: number;
  affinity: 'before' | 'after';
}

export interface TextRange {
  anchor: TextPoint;
  focus: TextPoint;
}
