import type { ShapeData } from '../runtime/loader.js';

// Presentation properties shared by the built-in shape primitives, independent
// of their source parameter names (a rectangle border is a line's stroke).
export type ShapeStyleField = 'fill' | 'strokeColor' | 'strokeWidth' | 'startHead' | 'endHead';

export function shapeStyleParam(shape: ShapeData, field: ShapeStyleField): string | null {
  const line = shape.comp.name === 'Line' || shape.comp.name === 'Arrow';
  const area = shape.comp.name === 'Box' || shape.comp.name === 'Ellipse';
  if (!line && !area) return null;
  switch (field) {
    case 'fill': return area ? 'fill' : null;
    case 'strokeColor': return line ? 'color' : 'borderColor';
    case 'strokeWidth': return line ? 'strokeWidth' : 'borderWidth';
    case 'startHead': case 'endHead': return line ? field : null;
  }
}
