// Measure in client pixels so click tolerance is independent of canvas zoom.
export function crossesDragThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= 4;
}
