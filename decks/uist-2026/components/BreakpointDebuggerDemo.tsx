import { useBuildStep } from '../../../slidewright/runtime/presentation.js';
import { useEffect, useRef, useState } from 'react';
import type { ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { execution } from '../chart-data.js';
import { InitialDebuggerCode } from './InitialDebuggerCode.js';

const breakpointStages = ['Code', 'Set breakpoint', 'Paused inspector'];
const steppingStages = ['Paused at breakpoint', 'Step forward ×2', 'Step backward ×3'];
const breakpointLine = 2;
// Trace snapshots are recorded after each statement. Pause before the discount.
const hit = execution.traces.base.find(trace => trace.path.includes(breakpointLine))!;
const breakpointPosition = hit.path.indexOf(breakpointLine);

function VariableValue({ value, animate }: { value: string; animate: boolean }) {
  const element = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  useEffect(() => {
    if (animate && previous.current !== value) {
      const animation = element.current?.animate([
        { background: 'var(--uist-markerYellow, #854d0e)', color: 'var(--uist-ink, #fef08a)' },
        { background: 'transparent', color: 'var(--uist-ink, #fff)' },
      ], { duration: 900, easing: 'ease-out' });
      previous.current = value;
      return () => animation?.cancel();
    }
    previous.current = value;
  }, [value, animate]);
  return <span ref={element} data-demo-variable-value>{value}</span>;
}

/** A short opening build using the same code and execution as the state-time demo. */
export default function BreakpointDebuggerDemo({ params }: ComponentRenderProps) {
  const stepping = params.mode === 'stepping';
  const stages = stepping ? steppingStages : breakpointStages;
  const { step, setStep, presenting } = useBuildStep(stages.length);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(breakpointPosition);
  const targetPosition = breakpointPosition + (stepping ? [0, 2, -1][step]! : 0);
  const animating = stepping && position !== targetPosition;
  useEffect(() => {
    if (!animating) return;
    // Walk the trace one statement at a time so each step of the animation is visible.
    const timer = setTimeout(() => setPosition(current => current + Math.sign(targetPosition - current)), 600);
    return () => clearTimeout(timer);
  }, [animating, position, targetPosition]);
  useEffect(() => {
    if (!playing || presenting) return;
    const timer = setTimeout(() => {
      if (step === stages.length - 1) setPlaying(false);
      else setStep(step + 1);
    }, 1800);
    return () => clearTimeout(timer);
  }, [playing, step, stages.length, presenting]);
  const code = execution.codeVariants.base;
  const width = Number(params.width), height = Number(params.height);
  const inspectorVisible = stepping || step === 2;
  // Trace snapshots are post-statement; the active line has not executed yet.
  const activeLine = inspectorVisible ? hit.path[position] : undefined;
  const variables = { ...hit.snapshots[position - 1]!, 'item.free_shipping': 'False' };
  const codeWidth = inspectorVisible ? (width - 24) * .65 : width;
  const fontSize = Math.min(48, (codeWidth - 64) / (Math.max(...code.lines.map(line => line.length)) + 6) / .62,
    (height - 120) / code.lines.length / 1.625);
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  function go(next: number) {
    setPlaying(false);
    setStep(next);
    if (next === 0) setPosition(breakpointPosition);
  }
  return <div data-sw-breakpoint-debugger data-mode={stepping ? 'stepping' : 'breakpoints'} data-step={step} data-animating={animating} style={{ position: 'absolute', left: Number(params.x), top: Number(params.y), width, height, display: 'flex', flexDirection: 'column', gap: 20, color: 'var(--uist-ink, #111)' }}>
    <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 24 }}>
      <div aria-label="Demo code" style={{ width: codeWidth, boxSizing: 'border-box', padding: '28px 32px', overflow: 'auto', border: '1px solid var(--uist-rule, #ddd)', borderRadius: 12, background: 'var(--uist-surface, #f9fafb)', fontFamily: 'var(--font-mono, monospace)', fontSize, lineHeight: 1.625, transition: 'width .5s, font-size .5s' }}>
        {/* Keep the gutter present before any line has a breakpoint. */}
        <InitialDebuggerCode lines={code.lines} breakpointLine={stepping || step >= 1 ? breakpointLine : -1} activeLine={activeLine} animateActiveLine={stepping} />
      </div>
      {inspectorVisible && <div aria-label="Demo variables" style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', overflow: 'auto', padding: 24, border: '1px solid var(--uist-rule, #1f2937)', borderRadius: 12, background: 'var(--uist-surface, #111827)', color: 'var(--uist-ink, #fff)', lineHeight: 1.625, fontFamily: 'var(--font-mono, monospace)', fontSize: Math.min(28, (width - codeWidth - 74) / 33 / .62) }}>
        <strong style={{ color: 'var(--uist-blue, #facc15)' }}>{stepping ? ['Paused at breakpoint', 'Stepped forward ×2', 'Stepped backward ×3'][step] : 'Paused at breakpoint'}</strong>
        <div style={{ color: 'var(--uist-muted, #9ca3af)', marginBottom: 20 }}>Variables · item {execution.traces.base.indexOf(hit) + 1}</div>
        {Object.entries(variables).map(([key, value]) => <div key={key} data-demo-variable style={{ marginBottom: 8 }}><span style={{ color: 'var(--uist-muted, #9ca3af)' }}>{key}</span>{' '}<VariableValue value={value} animate={stepping} /></div>)}
      </div>}
    </div>
    {!presenting && <div aria-label="Demo playback" role="group" onPointerDown={stop} onDoubleClick={stop} onKeyDown={stop} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, height: 45, fontSize: 20 }}>
      <button type="button" disabled={step === 0} onClick={() => go(step - 1)}>Previous demo step</button>
      <label>Stage <select aria-label="Demo stage" value={step} onChange={event => go(Number(event.target.value))}>{stages.map((name, index) => <option key={name} value={index}>{index + 1}: {name}</option>)}</select></label>
      <button type="button" disabled={step === stages.length - 1} onClick={() => go(step + 1)}>Next demo step</button>
      <button type="button" onClick={() => { if (step === stages.length - 1) { setStep(0); setPosition(breakpointPosition); } setPlaying(value => !value); }}>{playing ? 'Pause demo' : 'Play demo'}</button>
      <button type="button" onClick={() => go(0)}>Reset demo</button>
    </div>}
  </div>;
}
