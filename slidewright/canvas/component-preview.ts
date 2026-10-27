import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { Component } from '../runtime/ast.js';
import type { WrapShapeInput } from '../runtime/loader.js';
import { spanKey } from './gesture-context.js';

// A drag draft stays outside source authority. Only affected projections
// subscribe to changed snapshots; the deck and source editor stay untouched.
export class ComponentPreviews {
  private values = new Map<string, WrapShapeInput>();
  private listeners = new Map<string, Set<() => void>>();
  private commit: (() => void) | null = null;
  private active = false;
  resolve: (component: Component) => WrapShapeInput | null = () => null;
  subscribe(key: string, listener: () => void) {
    let listeners = this.listeners.get(key);
    if (!listeners) this.listeners.set(key, listeners = new Set());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(key);
    };
  }
  get = (key: string) => this.values.get(key) ?? null;
  begin = () => { this.cancel(); this.active = true; };
  stage(components: Component[], commit: () => void): void {
    if (!this.active) return;
    const values = new Map<string, WrapShapeInput>();
    for (const component of components) {
      const resolved = this.resolve(component);
      if (resolved) values.set(spanKey({ start: component.span.start.offset, end: component.span.end.offset }), resolved);
    }
    const changed = new Set([...this.values.keys(), ...values.keys()]);
    this.values = values;
    this.commit = commit;
    this.publish(changed);
  }
  finish = (phase: 'begin' | 'commit' | 'cancel') => {
    if (phase === 'begin') { this.begin(); return; }
    const commit = this.active && phase === 'commit' ? this.commit : null;
    this.cancel();
    commit?.();
  };
  cancel = () => {
    this.active = false;
    this.commit = null;
    if (!this.values.size) return;
    const changed = this.values.keys();
    this.values = new Map();
    this.publish(changed);
  };
  private publish(keys: Iterable<string>) {
    for (const key of keys) for (const listener of this.listeners.get(key) ?? []) listener();
  }
}

export const ComponentPreviewContext = createContext<ComponentPreviews | null>(null);
const emptySnapshot = () => null;
export function useComponentPreview(key: string): WrapShapeInput | null {
  const store = useContext(ComponentPreviewContext);
  const subscribe = useCallback((listener: () => void) => store?.subscribe(key, listener) ?? (() => {}), [store, key]);
  const snapshot = useCallback(() => store?.get(key) ?? null, [store, key]);
  return useSyncExternalStore(subscribe, snapshot, emptySnapshot);
}
