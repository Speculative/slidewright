import { useEffect, useState } from 'react';
import type { ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { useBuildStep } from '../../../slidewright/runtime/presentation.js';
import { calculatorPrintCode, calculatorOperations } from './calculator-explanation.js';
import { useCalculatorSlideTransition } from './calculator-slide-transition.js';
import { InitialDebuggerCode } from './InitialDebuggerCode.js';
import { DemoTerminal } from './DemoTerminal.js';

const stages = ['Place & Time', 'Print debugging', 'Add print statement', 'Execute first operation', 'Execute remaining operations'];
const operations = [
  { op: calculatorOperations[0]!, left: 4, right: 2, result: 8, caseLine: 8 },
  { op: calculatorOperations[1]!, left: 3, right: 8, result: 24, caseLine: 7 },
  { op: calculatorOperations[2]!, left: 2, right: 24, result: 26, caseLine: 6 },
];
const printLine = 9;
// Focus on the three operator calls, with recursive operand evaluation elided.
// The highlight follows each call; output appears only upon reaching print.
const frames = operations.flatMap((operation, index) =>
  [0, 1, 3, 4, 5, operation.caseLine, printLine, 10].map((line, offset) => ({
    line, operation: index, printed: index + (offset >= 6 ? 1 : 0),
  })));
const firstOperationEnd = 7;

/** The calculator counterpart of the original slow-print / remaining-prints builds. */
export default function CalculatorPrintPlaceTime({ params }: ComponentRenderProps) {
  const transitionBody = useCalculatorSlideTransition('print');
  const { step, setStep, presenting, staticRendering } = useBuildStep(stages.length);
  const [progress, setProgress] = useState({ step, frame: 0 });
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  // Derive the initial frame synchronously when navigating, so rewind never
  // briefly shows output from the previous build.
  const start = step === 4 ? firstOperationEnd + 1 : 0;
  const end = step === 3 ? firstOperationEnd : frames.length - 1;
  const frame = staticRendering ? end : progress.step === step ? progress.frame : start;
  const executing = step >= 3;
  const delay = step === 3 ? 360 : 240;
  useEffect(() => {
    if (staticRendering || !executing || frame >= end || (paused && !presenting)) return;
    const timer = setTimeout(() => setProgress({ step, frame: frame + 1 }), delay);
    return () => clearTimeout(timer);
  }, [executing, frame, end, paused, presenting, step, delay, staticRendering]);
  useEffect(() => {
    if (!playing || presenting || (executing && frame < end)) return;
    const timer = setTimeout(() => {
      if (step === stages.length - 1) setPlaying(false);
      else setStep(step + 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [playing, presenting, executing, frame, end, step, setStep]);

  const current = executing ? frames[frame]! : undefined;
  const operation = current ? operations[current.operation]! : undefined;
  const printed = current?.printed ?? 0;
  const finished = step === 4 && frame === end;
  const output = ['>>> calculate("2 + 3 * 4 ^ 2")', ...operations.slice(0, printed).map(operation => operation.op), ...(finished ? ['26'] : [])];
  const width = Number(params.width), height = Number(params.height);
  const codeWidth = width * .4;
  const fontSize = Math.max(1, Math.min(26,
    (codeWidth - 38) / (Math.max(...calculatorPrintCode.map(line => line.length)) + 3) / .62,
    ((height - 45) * .64 - 44) / ((calculatorPrintCode.length + .85) * 1.625)));
  // Reserve room for the heading, prompt, three logs, and final result.
  const terminalFontSize = Math.max(1, Math.min(28,
    (width * .4 - 48) / output[0]!.length / .62,
    ((height - 45) * .36 - 47) / (6 * 1.625)));
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  function go(next: number) {
    setPlaying(false); setPaused(false); setStep(next);
    setProgress({ step: next, frame: next === 4 ? firstOperationEnd + 1 : 0 });
  }

  return <div data-sw-debugger data-demo-calculator-print data-step={step} data-frame={frame} data-phase={step === 0 ? 'chart' : 'print'} style={{ position: 'absolute', left: Number(params.x), top: Number(params.y), width, height, display: 'flex', flexDirection: 'column', color: 'var(--uist-ink, #111)', background: 'var(--uist-paper, white)' }}>
    <style>{`@media (prefers-reduced-motion: reduce) {
      [data-demo-calculator-print] [data-demo-inserted-line],
      [data-demo-calculator-print] [data-demo-chart-layout],
      [data-demo-calculator-print] [data-demo-panels],
      [data-demo-calculator-print] [aria-label="Debugging technique"] { transition: none !important; }
    }`}</style>
    <div ref={transitionBody} data-demo-transition-body style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <div data-demo-chart-layout style={{ width: step === 0 ? '100%' : '60%', height: '100%', position: 'absolute', left: 0, top: 0, transition: 'width 700ms ease-in-out' }}>
        <div aria-label="Debugging technique" aria-hidden={step === 0} style={{ opacity: step === 0 ? 0 : 1, transition: 'opacity 700ms ease-in-out', position: 'absolute', left: '4%', top: -32, fontFamily: 'var(--font-body, sans-serif)' }}>
          <div style={{ fontSize: 48, fontWeight: 700, color: 'var(--uist-blue, #0000ff)' }}>print debugging</div>
          <div style={{ fontSize: 30, color: 'var(--uist-muted, #616161)' }}>Some Place · Across Time</div>
        </div>
        <svg data-demo-chart viewBox="0 0 900 520" role="img" aria-label="Place over Time" style={{ width: '100%', height: '100%', fontFamily: 'var(--font-body, sans-serif)' }}>
          <path d="M100 40 V460 H836" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <polygon points="100,33 94,47 106,47" fill="currentColor" /><polygon points="843,460 829,454 829,466" fill="currentColor" />
          <text data-demo-state-label transform="translate(50 250) rotate(-90)" textAnchor="middle" fontSize="36" fill="var(--uist-cyan, #00a8e8)">Place</text>
          <text data-demo-time-label x="460" y="500" textAnchor="middle" fontSize="36" fill="var(--uist-pink, #ff3d8b)">Time</text>
          {printed > 0 && <text x="125" y="360" fontSize="26">node.op</text>}
          {operations.slice(0, printed).map((operation, index) => <g key={operation.op}>
            {index > 0 && <line x1={220 + (index - 1) * 240} y1="390" x2={220 + index * 240} y2="390" stroke="var(--uist-blue, #0000ff)" strokeWidth="2.5" />}
            <circle data-demo-dot cx={220 + index * 240} cy="390" r="7" fill="var(--uist-blue, #0000ff)" />
            <text data-demo-operation-label x={220 + index * 240} y="430" textAnchor="middle" fontSize="30">{operation.op}</text>
          </g>)}
        </svg>
      </div>
      <div data-demo-panels aria-hidden={step === 0} inert={step === 0} style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: 'calc(40% - 16px)', opacity: step === 0 ? 0 : 1, pointerEvents: step === 0 ? 'none' : undefined, transition: 'opacity 700ms ease-in-out', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 15 }}>
        <div aria-label="Demo code" style={{ flex: '0 0 auto', padding: 18, border: '1px solid var(--uist-rule, #ddd)', borderRadius: 12, background: 'var(--uist-surface, #f9fafb)', fontFamily: 'var(--font-mono, monospace)', fontSize, lineHeight: 1.625, overflow: 'auto' }}>
          <div data-demo-call style={{ color: 'var(--uist-muted, #616161)', fontSize: fontSize * .85, marginBottom: 8, minHeight: '1.625em' }}>{operation ? `evaluate(node) · ${operation.left} ${operation.op} ${operation.right}${current?.line === 10 ? ` → ${operation.result}` : ''}` : 'evaluate(node)'}</div>
          <InitialDebuggerCode lines={calculatorPrintCode} insertedLines={[printLine]} showInsertedLines={step >= 2} highlightedLines={step === 2 ? [printLine] : []} activeLine={current?.line} colorfulSyntax />
        </div>
        <DemoTerminal lines={output} fontSize={terminalFontSize} />
      </div>
    </div>
    {!presenting && <div aria-label="Demo playback" role="group" onPointerDown={stop} onDoubleClick={stop} onKeyDown={stop} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, height: 45, fontSize: 20 }}>
      <button type="button" disabled={step === 0} onClick={() => go(step - 1)}>Previous demo step</button>
      <label>Stage <select aria-label="Demo stage" value={step} onChange={event => go(Number(event.target.value))}>{stages.map((name, index) => <option key={name} value={index}>{index + 1}: {name}</option>)}</select></label>
      <button type="button" disabled={step === stages.length - 1} onClick={() => go(step + 1)}>Next demo step</button>
      <button type="button" onClick={() => {
        if (playing) { setPlaying(false); setPaused(true); }
        else { if (step === stages.length - 1 && frame === end) go(0); setPaused(false); setPlaying(true); }
      }}>{playing ? 'Pause demo' : 'Play demo'}</button>
      <button type="button" onClick={() => go(0)}>Reset demo</button>
    </div>}
  </div>;
}
