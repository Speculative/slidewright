import { trace } from './tracing.js';
// Same seeded execution and item count as the original PLATEAU talk.
export const execution = trace(2, 16);
export const printDots: [number, number][] = [];
let first = 0, second = 0;
for (const iteration of execution.traces.printV2) {
  if (iteration.printOutputs.some(output => output.line === execution.codeVariants.printV2.printLines[0])) printDots.push(execution.printDots.row1[first++]!);
  if (iteration.printOutputs.some(output => output.line === execution.codeVariants.printV2.printLines[1])) printDots.push(execution.printDots.row2[second++]!);
}
export const totalY = Math.min((execution.printDots.row1[0]?.[1] ?? 250) + 80, 400);
export const shippingY = execution.printDots.row2[0]?.[1] ?? 300;
export const shipping = execution.autopsySliceXPositions.map((x, index) => ({ x, isTrue: execution.printDots.row2Indices.includes(index) }));
// Reproducible forward/backward walk: the original used Math.random().
export const stepSequence = [0];
let position = 0;
while (position < printDots.length - 1) {
  for (let advance = 0; advance < 4 && position < printDots.length - 1; advance++) stepSequence.push(++position);
  if (position < printDots.length - 1) stepSequence.push(--position);
}
