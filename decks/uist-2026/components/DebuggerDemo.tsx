import { useBuildStep } from '../../../slidewright/runtime/presentation.js';
import { useEffect, useState } from 'react';
import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { makeRectAdapter } from '../../../slidewright/canvas/rect-adapter.js';
import { execution as tr, printDots } from '../chart-data.js';
import BreakpointDebuggerDemo from './BreakpointDebuggerDemo.js';
import PrintDebuggerDemo from './PrintDebuggerDemo.js';
import { DemoTerminal } from './DemoTerminal.js';
import { InitialDebuggerCode } from './InitialDebuggerCode.js';
import { annotateCodeLine } from './debugger-code.js';
import { STEPS, executionFrames } from './debugger-stages.js';
export const slidewright: ComponentMeta = {
  produces: 'block', slots: {},
  params: { mode: { type: 'string', default: 'state-time' }, x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 }, width: { type: 'number', default: 1600 }, height: { type: 'number', default: 780 } },
  editor: { inspector: ['x', 'y', 'width', 'height'] },
};
export const canvas = makeRectAdapter({ width: 1600, height: 780 });
export default function DebuggerDemo(props: ComponentRenderProps) {
  if (props.params.mode === 'breakpoints' || props.params.mode === 'stepping') return <BreakpointDebuggerDemo {...props} />;
  return props.params.mode === 'prints' ? <PrintDebuggerDemo {...props} /> : <StateTimeDebuggerDemo {...props} />;
}
function StateTimeDebuggerDemo({ params }: ComponentRenderProps) {
  const placeTime = params.mode === 'place-time';
  const stages = placeTime ? STEPS.filter(stage => stage.phase !== 'autopsy') : STEPS;
  const { step, setStep, presenting } = useBuildStep(stages.length);
  const [frame, setFrame] = useState(0), [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const snap = stages[step]!;
  const frames = executionFrames(step);
  const delay = [11, 15, 18].includes(step) ? 200 : 50;
  useEffect(() => { setFrame(0); }, [step]);
  useEffect(() => {
    if (paused && !presenting) return;
    const length = executionFrames(step).length;
    if (!length) return;
    const timer = setInterval(() => setFrame(value => Math.min(value + 1, length - 1)), delay);
    return () => clearInterval(timer);
  }, [step, delay, paused, presenting]);
  useEffect(() => {
    if (!playing || presenting) return;
    const timer = setTimeout(() => { if (step === stages.length - 1) setPlaying(false); else setStep(step + 1); }, Math.max(frames.length - frame, 0) * delay + 1000);
    return () => clearTimeout(timer);
  }, [playing, step, delay, frames.length, frame, presenting, stages.length]);
  const current = frames[Math.min(frame, frames.length - 1)];
  const highlight = current?.line ?? snap.bpDebuggerHighlightLine;
  const iteration = current?.iteration ?? snap.bpDebuggerIteration;
  const terminal = current?.terminal ?? snap.printTerminalLines;
  const row1 = tr.printDots.row1.slice(0, current?.row1 ?? snap.printDotsVisibleRow1);
  const row2 = tr.printDots.row2.slice(0, current?.row2 ?? snap.printDotsVisibleRow2);
  const code = snap.printCodeVersion === 2 ? tr.codeVariants.printV2 : snap.printCodeVersion === 1 ? tr.codeVariants.printV1 : tr.codeVariants.base;
  const codeVisible = snap.phase === 'code' || snap.phase === 'breakpoint' || snap.phase === 'print' || snap.showAxisCode;
  const explaining = snap.phase === 'chart';
  const sideVisible = ['code', 'breakpoint', 'print'].includes(snap.phase);
  const panelsVisible = sideVisible || snap.showAxisCode;
  const explanationWidth = Number(params.width) * .75;
  const explanationCodeWidth = snap.showCostTerminal ? (explanationWidth - 16) * 2 / 3 : explanationWidth;
  const longestLine = Math.max(...code.lines.map(line => line.length));
  // Include the explanatory card's padding and one-pixel borders in fitting.
  const explanationFontSize = Math.max(1, Math.min(48,
    (explanationCodeWidth - 66) / (longestLine + 1) / .62,
    ((Number(params.height) - 45) * .75 - 50) / code.lines.length / 1.625));
  const technique = snap.stateTimeStep === 1 ? 'breakpoint' : snap.stateTimeStep >= 2 && snap.stateTimeStep <= 10 ? 'print' : null;
  const appear = (duration: number, delay = 0) => ({ animation: `sw-demo-appear ${duration}ms ease-out ${delay}ms both` });
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  function go(next: number) { setPlaying(false); setPaused(false); setStep(next); }
  return <div data-sw-debugger data-frame={frame} data-step={step} data-phase={snap.phase} style={{ position: 'absolute', left: Number(params.x), top: Number(params.y), width: Number(params.width), height: Number(params.height), color: 'var(--uist-ink, #111)', background: 'var(--uist-paper, white)', display: 'flex', flexDirection: 'column' }}>
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <svg data-demo-chart aria-hidden={snap.phase === 'code'} viewBox="0 0 900 520" role="img" aria-label={placeTime ? 'Place over Time' : 'Program state over time'} style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: snap.phase === 'code' ? '0%' : sideVisible ? '60%' : '100%', opacity: snap.phase === 'code' ? 0 : 1, pointerEvents: snap.phase === 'code' ? 'none' : undefined, transition: 'width .7s, opacity .7s', fontFamily: 'var(--font-body, sans-serif)' }}>
        <rect x="100" y="40" width="720" height="420" fill="white" />
        <style>{`@keyframes sw-demo-appear { from { opacity: 0; } to { opacity: 1; } } @keyframes sw-demo-accent { from { background-color: #fef08a; } to { background-color: transparent; } }`}</style>
        <g data-demo-axes opacity={snap.axisFade.axisOpacity} style={{ transition: 'opacity .4s' }}>
          <path d="M100 40 V460 H836" fill="none" stroke="black" strokeWidth="2.5" />
          <polygon points="100,33 94,47 106,47" /><polygon points="843,460 829,454 829,466" />
        </g>
        <text data-demo-state-label opacity={snap.titleLabel === 'time' ? snap.axisFade.axisOpacity : 1} x="0" y="0" textAnchor="middle" fontSize={snap.psLabel.fontSize} transform={`translate(${snap.psLabel.x} ${snap.psLabel.y}) rotate(${snap.psLabel.rotate})`} style={{ transition: 'transform .6s, font-size .6s, opacity .4s' }}>{placeTime ? 'Place' : 'program state'}</text>
        <text data-demo-time-label opacity={snap.titleLabel === 'state' ? snap.axisFade.axisOpacity : 1} x="0" y="0" textAnchor="middle" fontSize={snap.tLabel.fontSize} transform={`translate(${snap.tLabel.x} ${snap.tLabel.y})`} style={{ transition: 'transform .6s, font-size .6s, opacity .4s' }}>{placeTime ? 'Time' : 'time'}</text>
        {snap.stateVarLabelTargets.map((target, index) => <text key={index} data-demo-variable-label x="0" y="0" transform={`translate(${target.x} ${target.y})`} opacity={snap.showStateVarLabels ? target.opacity : 0} fontSize="36" style={{ transition: 'transform .5s, opacity .5s' }}>{tr.stateVarNames[index]}</text>)}
        {snap.costLabelTargets.map((target, index) => <text key={index} data-demo-cost-label x="0" y="0" textAnchor="middle" opacity={snap.showCostLabels ? target.opacity : 0} transform={`translate(${target.x} ${target.y}) rotate(${target.rotate})`} fontSize="36" style={{ transition: 'transform .5s, opacity .5s' }}>{tr.costValues[index]}</text>)}
        {snap.phase === 'breakpoint' && <rect data-demo-breakpoint x={tr.breakpointXPositions[iteration]! - 12} y="40" width="24" height="420" fill="#1E40AF" style={{ ...appear(300), transition: `x ${delay}ms` }} />}
        {snap.stateTimeStep >= 5 && snap.stateTimeStep <= 7 && [row1, row2].map((row, index) => <g key={index}><polyline data-demo-row points={row.map(dot => dot.join(',')).join(' ')} fill="none" stroke="#991B1B" strokeWidth="2.5" />{row.map(([cx, cy], index) => <circle key={index} data-demo-dot cx={cx} cy={cy} r="6" fill="#991B1B" style={appear(150)} />)}</g>)}
        {step >= 15 && <text x={tr.printDots.row1[0]![0]} y={tr.printDots.row1[0]![1] + 28} fontSize="20" fill="#991B1B">price</text>}
        {step >= 18 && <text x={tr.printDots.row2[0]![0]} y={tr.printDots.row2[0]![1] - 14} fontSize="20" fill="#991B1B">free_shipping</text>}
        {snap.stateTimeStep === 10 && <g data-demo-zigzag>
          {printDots.map(([cx, cy], index) => <g key={index}>
            {index > 0 && <line x1={printDots[index - 1]![0]} y1={printDots[index - 1]![1]} x2={cx} y2={cy} stroke="#991B1B" strokeWidth="2.5" strokeLinecap="round" style={appear(100, index * 30)} />}
            <circle data-demo-dot cx={cx} cy={cy} r="6" fill="#991B1B" style={appear(100, index * 30)} />
          </g>)}
        </g>}
        {snap.phase === 'autopsy' && tr.autopsySliceXPositions.map((x, index) => <rect key={index} data-demo-slice x={x - 12} y="40" width="24" height="420" rx="4" fill="#1E40AF" fillOpacity=".2" style={appear(150, index * 60)} />)}
      </svg>
      {technique && <div aria-label="Debugging technique" style={{ position: 'absolute', left: sideVisible ? '2.4%' : '4%', top: placeTime ? -32 : '6%', borderRadius: 6, background: 'rgba(255, 255, 255, .85)', padding: '8px 16px', fontFamily: 'var(--font-body, sans-serif)' }}>
        <div style={{ fontSize: 48, fontWeight: 700, color: '#1E40AF', lineHeight: 1.25 }}>{technique === 'breakpoint' ? 'breakpoint debugger' : 'print debugging'}</div>
        <div style={{ fontSize: 30, color: '#6b7280', lineHeight: 1.25 }}>{technique === 'breakpoint' ? (placeTime ? 'Across Place · Point in Time' : 'all state · one moment') : (placeTime ? 'some Place · Across Time' : 'some state · many moments')}</div>
      </div>}
      <div data-demo-panels data-demo-explanation={explaining && snap.showAxisCode ? true : undefined} aria-hidden={!panelsVisible} style={{ position: 'absolute', right: explaining ? '12.5%' : 0, top: explaining ? '50%' : 0, transform: explaining ? 'translateY(-50%)' : 'none', height: explaining ? 'auto' : '100%', maxHeight: explaining ? '75%' : '100%', opacity: panelsVisible ? 1 : 0, pointerEvents: panelsVisible ? undefined : 'none', transition: 'width .7s, right .7s, top .7s, transform .7s, opacity .7s', width: explaining ? '75%' : snap.phase === 'code' ? '100%' : '40%', display: 'flex', flexDirection: explaining ? 'row' : 'column', gap: explaining ? 16 : 15, minHeight: 0 }}>
        <div aria-label="Demo code" aria-hidden={!codeVisible} style={{ opacity: codeVisible ? 1 : 0, pointerEvents: codeVisible ? undefined : 'none', transition: 'opacity .7s, font-size .7s', flex: explaining ? 2 : 1, minWidth: 0, boxSizing: 'border-box', overflow: 'auto', border: '1px solid var(--uist-rule, #ddd)', borderRadius: 12, padding: explaining ? '24px 32px' : 18, background: explaining ? 'var(--uist-paper, rgba(255, 255, 255, .95))' : 'var(--uist-surface, #f9fafb)', boxShadow: explaining ? '0 8px 24px rgba(0,0,0,.15)' : undefined, lineHeight: explaining ? 1.625 : undefined, fontFamily: 'var(--font-mono, monospace)', fontSize: explaining ? explanationFontSize : snap.phase === 'code' ? 40 : Math.min(24, (Number(params.width) * .4 - 50) / (Math.max(...code.lines.map(line => line.length)) + 4) / .62) }}>
          {snap.phase === 'code' ? <InitialDebuggerCode lines={code.lines} /> : code.lines.map((line, index) => <div key={index} data-demo-code-line={index} style={{ whiteSpace: 'pre', transition: snap.instantHighlight ? 'none' : 'background-color .2s', background: index === highlight ? 'var(--uist-markerYellow, #fef08a)' : 'transparent' }}>{!explaining && <span style={{ color: 'var(--uist-muted, #888)' }}>{index + 1} </span>}{snap.phase === 'breakpoint' && index === 2 ? '● ' : ''}<span key={`code-${step}`} data-demo-print-accent={[14, 17].includes(step) && code.printLines.includes(index) ? true : undefined} style={{ animation: [14, 17].includes(step) && code.printLines.includes(index) ? 'var(--uist-code-accent-animation, sw-demo-accent) 800ms step-end both' : undefined }}>{annotateCodeLine(explaining && !line ? '    ...' : line, snap.axisCodeHighlight).map((part, partIndex) => <span key={partIndex} data-demo-annotation={part.highlighted ? snap.axisCodeHighlight : undefined} style={{ background: part.highlighted ? 'var(--uist-markerYellow, #fef08a)' : 'transparent', color: snap.axisCodeHighlight && !part.highlighted ? 'var(--uist-muted, #6b7280)' : undefined, borderRadius: 4, transition: 'background-color .3s' }}>{part.text}</span>)}</span></div>)}
        </div>
        {snap.rightPanel === 'variables' && <div aria-label="Demo variables" style={{ flex: 1, overflow: 'auto', padding: 24, border: '1px solid var(--uist-rule, #1f2937)', borderRadius: 12, background: 'var(--uist-surface, #111827)', color: 'var(--uist-blue, #4ade80)', lineHeight: 1.625, fontFamily: 'var(--font-mono, monospace)', fontSize: 22 }}>
          <div style={{ color: 'var(--uist-muted, #9ca3af)', fontSize: 18, marginBottom: 8 }}>Variables · item {iteration + 1}</div>{Object.entries(tr.breakpointSnapshots[iteration]!).map(([key, value]) => <div key={key}><span style={{ color: 'var(--uist-muted, #6b7280)' }}>{key}</span> <span data-demo-variable-value style={{ color: 'var(--uist-ink, #fff)' }}>{value}</span></div>)}
        </div>}
        {snap.rightPanel === 'terminal' && !snap.showCostTerminal && <DemoTerminal lines={terminal} />}
        {snap.showCostTerminal && <div aria-label="Demo terminal" style={{ flex: 1, minWidth: 0, minHeight: 0, boxSizing: 'border-box', overflow: 'auto', padding: 16, borderRadius: 12, lineHeight: 1.625, background: 'var(--uist-surface, #111827)', color: 'var(--uist-blue, #4ade80)', fontFamily: 'var(--font-mono, monospace)', fontSize: 22 }}>{tr.terminalLines.map(([label, value], index) => <div key={index} data-demo-cost-row>{label} <span data-demo-cost-value style={{ color: 'var(--uist-ink, #fff)' }}>{value}</span></div>)}</div>}
      </div>
    </div>
    {!presenting && <div aria-label="Demo playback" role="group" onPointerDown={stop} onDoubleClick={stop} onKeyDown={stop} style={{ display: 'flex', justifyContent: 'center', gap: 12, height: 45, fontSize: 20 }}>
      <button type="button" disabled={step === 0} onClick={() => go(step - 1)}>Previous demo step</button>
      <label>Stage <select aria-label="Demo stage" value={step} onChange={event => go(Number(event.target.value))}>{stages.map((stage, index) => <option key={index} value={index}>{index + 1}: {stage.phase}</option>)}</select></label>
      <button type="button" disabled={step === stages.length - 1} onClick={() => go(step + 1)}>Next demo step</button>
      <button type="button" onClick={() => { if (step === stages.length - 1) setStep(0); setPaused(playing); setPlaying(value => !value); }}>{playing ? 'Pause demo' : 'Play demo'}</button>
      <button type="button" onClick={() => { go(0); setFrame(0); }}>Reset demo</button>
    </div>}
  </div>;
}
