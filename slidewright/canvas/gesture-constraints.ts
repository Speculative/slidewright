// Project a vector onto the nearest horizontal, vertical, or 45° direction.
export function snapDirection(dx: number, dy: number): { x: number; y: number } {
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const ux = Math.round(Math.cos(angle));
  const uy = Math.round(Math.sin(angle));
  const distance = (dx * ux + dy * uy) / (ux * ux + uy * uy);
  return { x: distance * ux, y: distance * uy };
}
