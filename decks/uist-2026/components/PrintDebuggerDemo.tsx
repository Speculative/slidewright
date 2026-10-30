import { useBuildStep } from '../../../slidewright/runtime/presentation.js';
import { useEffect, useState } from 'react';
import type { ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { execution } from '../chart-data.js';
import { InitialDebuggerCode } from './InitialDebuggerCode.js';
import { DemoTerminal } from './DemoTerminal.js';

const stages = ['Code', 'Add print statements', 'Console output'];
const output = execution.traces.printV2.flatMap(trace => trace.printOutputs.map(line => line.text));

/** A short opening build using the same code and execution as the state-time demo. */
export default function PrintDebuggerDemo({ params }: ComponentRenderProps) {
  const { step, setStep, presenting } = useBuildStep(stages.length);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || presenting) return;
    const timer = setTimeout(() => {
      if (step === stages.length - 1) setPlaying(false);
      else setStep(step + 1);
    }, 1800);
    return () => clearTimeout(timer);
  }, [playing, step, presenting]);
  // Keep authored rows mounted so print insertion opens space without replacing the code.
  const code = execution.codeVariants.printV2;
  const width = Number(params.width), height = Number(params.height);
  const codeWidth = step === 2 ? (width - 24) * .73 : width;
  const fontSize = Math.min(48, (codeWidth - 64) / (Math.max(...code.lines.map(line => line.length)) + 4) / .62,
    (height - 120) / code.lines.length / 1.625);
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  function go(next: number) { setPlaying(false); setStep(next); }
  return <div data-sw-print-debugger data-step={step} style={{ position: 'absolute', left: Number(params.x), top: Number(params.y), width, height, display: 'flex', flexDirection: 'column', gap: 20, color: 'var(--uist-ink, #111)' }}>
    <style>{`@media (prefers-reduced-motion: reduce) {
      [data-sw-print-debugger] [data-demo-inserted-line] { transition: none !important; }
    }`}</style>
    <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 24 }}>
      <div aria-label="Demo code" style={{ width: codeWidth, boxSizing: 'border-box', padding: '28px 32px', overflow: 'auto', border: '1px solid var(--uist-rule, #ddd)', borderRadius: 12, background: 'var(--uist-surface, #f9fafb)', fontFamily: 'var(--font-mono, monospace)', fontSize, lineHeight: 1.625, transition: 'width .5s, font-size .5s' }}>
        <InitialDebuggerCode lines={code.lines} highlightedLines={step > 0 ? code.printLines : []} insertedLines={code.printLines} showInsertedLines={step > 0} />
      </div>
      {step === 2 && <DemoTerminal lines={output} fontSize={Math.min(28, (height - 120) / (output.length + 1) / 1.625)} />}
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
