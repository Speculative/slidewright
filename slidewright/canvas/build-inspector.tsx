import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { Diamond } from 'lucide-react';
import type { Component, Value } from '../runtime/ast.js';
import type { ShapeData } from '../runtime/loader.js';
import { buildEditRange, buildProperty, objectId, type BuildDirection } from '../runtime/builds.js';
import { emitValue } from '../runtime/emitter.js';

export interface BuildInspectorState {
  slide: Component;
  frameIndex: number;
  direction: BuildDirection;
  defaultValue?(object: Component, property: string): Value | undefined;
  toggle(object: Component, property: string, defaultValue?: unknown): void;
}
export const BuildInspectorContext = createContext<BuildInspectorState | null>(null);

const displayValue = (value: Value | undefined): string => value ? emitValue(value).replace(/\s+/g, ' ') : 'default';

export function BuildPropertyControl({ owner, property, defaultValue, children }: {
  owner: Component; property: string; defaultValue?: unknown; children: ReactNode;
}): ReactElement {
  const context = useContext(BuildInspectorContext);
  const id = objectId(owner);
  if (!context || !id || ['id', 'builds', 'children'].includes(property)) return <>{children}</>;
  let current;
  try { current = buildProperty(context.slide, context.frameIndex, id, property); }
  catch { return <>{children}</>; }
  const previous = context.frameIndex > 0 ? buildProperty(context.slide, context.frameIndex - 1, id, property) : current;
  const fallback = context.defaultValue?.(owner, property);
  const before = displayValue(previous.value ?? fallback);
  const after = displayValue(current.value ?? fallback);
  const changed = before !== after;
  const range = buildEditRange(context.slide, context.frameIndex, id, [property], context.direction);
  const origin = current.origin === null ? 'component default' : current.origin === 0 ? 'initial frame' : `build ${current.origin}`;
  const title = current.keyframed
    ? context.frameIndex === 0 ? 'Initial value: there is no preceding frame to inherit from' : 'Keyframed here. Click to inherit from the preceding frame.'
    : `Inherited from ${origin}. Click to keyframe this value here, even if unchanged.`;
  return <div className={`sw-build-property${changed ? ' sw-build-property-changed' : ''}`}
    data-build-property={property} data-keyframed={current.keyframed}>
    <div className="sw-build-property-content" title={`Editing affects frames ${range.first + 1}–${range.last + 1}`}>{children}</div>
    <button type="button" className="sw-keyframe-toggle" aria-label={`${current.keyframed ? 'Inherit' : 'Keyframe'} ${property}`}
      aria-pressed={current.keyframed} title={title} disabled={context.frameIndex === 0 && current.keyframed}
      onMouseDown={event => event.preventDefault()} onClick={() => context.toggle(owner, property, defaultValue)}>
      <Diamond size={13} fill={current.keyframed ? 'currentColor' : 'none'} />
    </button>
    {changed && <span className="sw-build-value-change" title={`${before} → ${after}`}>{before} → {after}</span>}
  </div>;
}

export function BuildObjectBadge({ object }: { object: Component }): ReactElement | null {
  const context = useContext(BuildInspectorContext);
  const id = objectId(object);
  if (!context || !id) return null;
  let state;
  try { state = buildProperty(context.slide, context.frameIndex, id, 'visible'); }
  catch { return null; }
  const hidden = state.value?.kind === 'boolean' && !state.value.value;
  const previous = context.frameIndex > 0 ? buildProperty(context.slide, context.frameIndex - 1, id, 'visible') : null;
  const entered = !hidden && previous?.value?.kind === 'boolean' && !previous.value.value;
  return hidden || entered ? <span className={`sw-build-object-badge${hidden ? ' hidden-object' : ''}`}>
    {hidden ? 'hidden' : 'enters'}
  </span> : null;
}

/** Dedicated typography controls intentionally hide these fields from the
 * generic inspector. Their keyframe buttons still need an accessible home. */
export function AdditionalBuildKeyframes({ shape }: { shape: ShapeData | null }): ReactElement | null {
  const context = useContext(BuildInspectorContext);
  if (!context || !shape?.meta.editor || !objectId(shape.comp)) return null;
  const schemas: Record<string, { type: string; default?: unknown }> = { visible: { type: 'boolean', default: true }, opacity: { type: 'number', default: 1 },
    ...shape.meta.slots, ...shape.meta.params };
  const names = Object.keys(schemas).filter(name => !shape.meta.editor!.inspector.includes(name) && !['children', 'visible', 'opacity'].includes(name));
  if (!names.length) return null;
  return <details className="sw-additional-keyframes"><summary>Additional property keyframes</summary>
    {names.map(name => <BuildPropertyControl key={name} owner={shape.comp} property={name}
      defaultValue={'default' in schemas[name]! ? schemas[name]!.default : undefined}>
      <div className="sw-property-row"><span className="sw-property-key">{name}</span>
        <span className="sw-property-value sw-property-value-readonly">{displayValue(shape.comp.fills.find(fill => fill.name === name)?.value)}</span></div>
    </BuildPropertyControl>)}
  </details>;
}
