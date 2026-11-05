import { createContext, useContext, useEffect, useId, useState, useSyncExternalStore } from 'react';

/** Ephemeral slide build state; never written into the authored source. */
export class PresentationBuild {
  private step = 0;
  private counts = new Map<string, number>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.step;
  register(id: string, count: number) {
    this.counts.set(id, count);
    return () => { this.counts.delete(id); };
  }
  stageCount = () => Math.max(1, ...this.counts.values());
  advance(direction: number): boolean {
    const last = Math.max(1, ...this.counts.values()) - 1;
    const next = Math.max(0, Math.min(last, this.step + direction));
    if (next === this.step) return false;
    this.step = next;
    this.listeners.forEach(listener => listener());
    return true;
  }
  reset() {
    this.step = 0;
    this.listeners.forEach(listener => listener());
  }
}

export const PresentationContext = createContext<{ build: PresentationBuild; preview?: boolean; exportStep?: number | 'final' } | null>(null);
const idle = new PresentationBuild();

/** Each registered visual advances together, clamped at its final authored stage.
 * Local state and setters remain available to authoring playback controls.
 * Presentation waits at every stage; animation within a stage runs normally.
 */
export function useBuildStep(count: number) {
  const presentation = useContext(PresentationContext);
  const [localStep, setStep] = useState(0);
  const id = useId();
  const build = presentation?.build ?? idle;
  const step = useSyncExternalStore(build.subscribe, build.snapshot, build.snapshot);
  const preview = presentation?.preview;
  const presenting = !!presentation;
  useEffect(() => {
    if (!presenting || preview) return;
    return build.register(id, count);
  }, [build, id, count, presenting, preview]);
  const exportStep = presentation?.exportStep;
  return {
    step: exportStep === 'final' ? count - 1 : typeof exportStep === 'number'
      ? Math.min(exportStep, count - 1) : presentation ? Math.min(step, count - 1) : localStep,
    setStep, presenting, staticRendering: exportStep !== undefined,
  };
}
