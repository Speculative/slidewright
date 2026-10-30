import { InitialDebuggerCode } from '../../../decks/uist-2026/components/InitialDebuggerCode.js';
import { annotateCodeLine } from '../../../decks/uist-2026/components/debugger-code.js';
import { STEPS, executionFrames } from '../../../decks/uist-2026/components/debugger-stages.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadDeck } from '../loader.js';
import { emit } from '../emitter.js';
import { parse } from '../parser.js';
import { components } from '../../../decks/v0-reference/registry.js';
import { execution, printDots, shipping, stepSequence } from '../../../decks/uist-2026/chart-data.js';
import { chartModes, chartStepCount } from '../../../decks/uist-2026/components/StateTimeChart.js';
const source = readFileSync('tests/fixtures/plateau-charts.sw', 'utf8');
const result = loadDeck({ source, file: 'charts.sw', components, scope: { bindings: {} } });
assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
assert.equal(result.slides.length, 5);
assert.equal(execution.autopsySliceXPositions.length, 16);
assert.equal(printDots.length, execution.printDots.row1.length + execution.printDots.row2.length);
assert.equal(shipping.filter(dot => dot.isTrue).length, execution.printDots.row2Indices.length);
assert.equal(stepSequence.at(-1), printDots.length - 1);
assert.ok(stepSequence.some((value, index) => index > 0 && value < stepSequence[index - 1]!));
for (const mode of chartModes) assert.ok(chartStepCount(mode) >= 2);
const html = renderToStaticMarkup(createElement('div', null, result.slides));
assert.match(html, /breakpoint debugger/);
assert.match(html, /program state/);
assert.match(html, /data-chart-cursor/);
assert.match(html, /data-chart-shipping/);
// Canvas, thumbnails and presenter previews share a document; SVG markers
// must remain local to each chart instance.
const markers = [...html.matchAll(/<marker id="([^"]+)"/g)].map(match => match[1]);
assert.equal(markers.length, chartModes.length);
assert.equal(new Set(markers).size, markers.length);
assert.match(html, /@keyframes sw-chart-appear/);
assert.equal(emit(parse(emit(parse(source, 'charts.sw').ast), 'charts.sw').ast), emit(parse(source, 'charts.sw').ast));
console.log('OK   PLATEAU trace fidelity, chart modes, SSR, and source round-trip');

assert.equal(STEPS.length, 22);
assert.equal(STEPS[21]!.phase, 'autopsy');
assert.equal(executionFrames(11).at(-1)!.iteration, 1);
assert.equal(executionFrames(12).at(-1)!.iteration, 7);
for (const step of [15, 16, 18, 19]) {
  const last = executionFrames(step).at(-1)!;
  assert.deepEqual(last.terminal, STEPS[step]!.printTerminalLines);
  assert.equal(last.row1, STEPS[step]!.printDotsVisibleRow1);
  assert.equal(last.row2, STEPS[step]!.printDotsVisibleRow2);
}

// The original explanation highlights state expressions, then only the two
// operations. Annotation must preserve the complete displayed program text.
for (const mode of [null, 'state-vars', 'cost'] as const) {
  for (const line of execution.codeVariants.base.lines) {
    assert.equal(annotateCodeLine(line, mode).map(part => part.text).join(''), line);
  }
}
const highlighted = (mode: 'state-vars' | 'cost') => execution.codeVariants.base.lines.flatMap(line => annotateCodeLine(line, mode).filter(part => part.highlighted).map(part => part.text));
assert.deepEqual(highlighted('state-vars'), execution.stateVarNames);
assert.deepEqual(highlighted('cost'), ['item.price', 'item.total()']);
assert.deepEqual(annotateCodeLine('itemized cartwheel item.other', 'state-vars').filter(part => part.highlighted), []);

const syntax = renderToStaticMarkup(createElement(InitialDebuggerCode, { lines: ['for item in cart:', '    if item.qty < 10 & True:', ''] }));
assert.match(syntax, /class="token keyword" style="color:var\(--uist-ink, #d73a49\)">for/);
assert.match(syntax, /&lt;/);
assert.match(syntax, /&amp;/);
assert.equal((syntax.match(/data-demo-code-line=/g) ?? []).length, 3);
