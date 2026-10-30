import { useEffect, useState } from 'react';
import type { ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { useBuildStep } from '../../../slidewright/runtime/presentation.js';
import { calculatorCode } from './calculator-explanation.js';
import { useCalculatorSlideTransition } from './calculator-slide-transition.js';
import { InitialDebuggerCode } from './InitialDebuggerCode.js';

const stages = ['Pause at line 6', 'Execute line 9'];

/** Two moments in the same operator call expose a complete slice of state. */
export default function CalculatorBreakpointPlaceTime({ params }: ComponentRenderProps) {
  const transitionBody = useCalculatorSlideTransition('breakpoint');
  const { step, setStep, presenting } = useBuildStep(stages.length);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || presenting) return;
    const timer = setTimeout(() => {
      if (step === stages.length - 1) setPlaying(false);
      else setStep(step + 1);
    }, 2000);
    return () => clearTimeout(timer);
  }, [playing, presenting, step, setStep]);
  const width = Number(params.width), height = Number(params.height);
  const codeFontSize = Math.max(1, Math.min(26,
    (width * .4 - 54) / (Math.max(...calculatorCode.map(line => line.length)) + 3) / .62,
    ((height - 45) * .64 - 44) / ((calculatorCode.length + .85) * 1.625)));
  const inspectorFontSize = Math.max(1, Math.min(24, ((height - 45) * .36 - 55) / (5 * 1.625)));
  const variables = [
    ['node', 'BinOp("^")'], ['node.value', '—'],
    ['node.left', 'Num(4)'], ['node.right', 'Num(2)'],
    ['left', '4'], ['right', '2'],
    ['node.op', '"^"'], ['result', step === 0 ? 'not assigned' : '8'],
  ];
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  function go(next: number) { setPlaying(false); setStep(next); }
  return <div data-sw-debugger data-demo-calculator-breakpoint data-step={step} data-phase="breakpoint" style={{ position: 'absolute', left: Number(params.x), top: Number(params.y), width, height, display: 'flex', flexDirection: 'column', color: 'var(--uist-ink, #111)', background: 'var(--uist-paper, white)' }}>
    <style>{`@media (prefers-reduced-motion: reduce) {
      [data-demo-calculator-breakpoint] [data-demo-breakpoint],
      [data-demo-calculator-breakpoint] [data-demo-line-highlight] { transition: none !important; }
    }`}</style>
    <div ref={transitionBody} data-demo-transition-body style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: '60%', height: '100%' }}>
        <div aria-label="Debugging technique" style={{ position: 'absolute', left: '4%', top: -32, fontFamily: 'var(--font-body, sans-serif)' }}>
          <div style={{ fontSize: 48, fontWeight: 700, color: 'var(--uist-blue, #0000ff)' }}>breakpoint debugging</div>
          <div style={{ fontSize: 30, color: 'var(--uist-muted, #616161)' }}>Across Place · Point in Time</div>
        </div>
        <svg data-demo-chart viewBox="0 0 900 520" role="img" aria-label="Place over Time" style={{ width: '100%', height: '100%', fontFamily: 'var(--font-body, sans-serif)' }}>
          <path d="M100 40 V460 H836" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <polygon points="100,33 94,47 106,47" fill="currentColor" /><polygon points="843,460 829,454 829,466" fill="currentColor" />
          <text data-demo-state-label transform="translate(50 250) rotate(-90)" textAnchor="middle" fontSize="36" fill="var(--uist-cyan, #00a8e8)">Place</text>
          <text data-demo-time-label x="460" y="500" textAnchor="middle" fontSize="36" fill="var(--uist-pink, #ff3d8b)">Time</text>
          <rect data-demo-breakpoint x={step === 0 ? 208 : 308} y="40" width="24" height="420" fill="var(--uist-blue, #0000ff)" style={{ transition: 'x 700ms ease-in-out' }} />
        </svg>
      </div>
      <div data-demo-panels style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: 'calc(40% - 16px)', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 15 }}>
        <div aria-label="Demo code" style={{ flex: '0 0 auto', padding: 18, border: '1px solid var(--uist-rule, #ddd)', borderRadius: 12, background: 'var(--uist-surface, #f9fafb)', fontFamily: 'var(--font-mono, monospace)', fontSize: codeFontSize, lineHeight: 1.625, overflow: 'auto' }}>
          <div style={{ color: 'var(--uist-muted, #616161)', fontSize: codeFontSize * .85, marginBottom: 8 }}>evaluate(node) · 4 ^ 2</div>
          <InitialDebuggerCode lines={calculatorCode} activeLine={step === 0 ? 5 : 8} animateActiveLine colorfulSyntax />
        </div>
        <div aria-label="Demo variables" style={{ flex: 1, minHeight: 0, padding: 16, boxSizing: 'border-box', overflow: 'auto', borderRadius: 12, background: 'var(--uist-surface, #f9fafb)', fontFamily: 'var(--font-mono, monospace)', fontSize: inspectorFontSize, lineHeight: 1.625 }}>
          <strong>Variables · evaluate</strong>
          <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0 16px', margin: '8px 0 0' }}>
            {variables.map(([name, value]) => <div key={name} data-demo-variable={name} style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
              <dt style={{ color: 'var(--uist-muted, #616161)' }}>{name}</dt>
              <dd data-demo-variable-value style={{ margin: 0 }}>{value}</dd>
            </div>)}
          </dl>
        </div>
      </div>
    </div>
    {!presenting && <div aria-label="Demo playback" role="group" onPointerDown={stop} onDoubleClick={stop} onKeyDown={stop} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, height: 45, fontSize: 20 }}>
      <button type="button" disabled={step === 0} onClick={() => go(step - 1)}>Previous demo step</button>
      <label>Stage <select aria-label="Demo stage" value={step} onChange={event => go(Number(event.target.value))}>{stages.map((name, index) => <option key={name} value={index}>{index + 1}: {name}</option>)}</select></label>
      <button type="button" disabled={step === stages.length - 1} onClick={() => go(step + 1)}>Next demo step</button>
      <button type="button" onClick={() => { if (step === stages.length - 1) setStep(0); setPlaying(value => !value); }}>{playing ? 'Pause demo' : 'Play demo'}</button>
      <button type="button" onClick={() => go(0)}>Reset demo</button>
    </div>}
  </div>;
}
