import type { Pos } from './ast.js';

export function lineStarts(source: string): readonly number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  return starts;
}

export function position(starts: readonly number[], offset: number): Pos {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid;
  }
  return { offset, line: low + 1, column: offset - starts[low]! + 1 };
}
