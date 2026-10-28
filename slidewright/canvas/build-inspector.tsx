import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { Diamond } from 'lucide-react';
import type { Component, Value } from '../runtime/ast.js';
import type { ShapeData } from '../runtime/loader.js';
import { buildEditRange, buildProperty, isBuildAppearance, objectId, type BuildDirection } from '../runtime/builds.js';
import { emitValue } from '../runtime/emitter.js';

export interface BuildInspectorState {
  slide: Component;
  frameIndex: number;
  direction: BuildDirection;
  defaultValue?(object: Component, property: string): Value | undefined;
  toggle(object: Component, property: string, defaultValue?: unknown): void;
  setFormattingKeyframes(objects: Component[], property: string, pinned: boolean): void;
}
export const BuildInspectorContext = createContext<BuildInspectorState | null>(null);

export function BuildFormattingScope(): ReactElement | null {
  const context = useContext(BuildInspectorContext);
  if (!context) return null;
  return <span className="sw-formatting-build-scope" aria-label="Formatting propagation">
    {context.direction === 'everywhere' ? 'Everywhere' : context.direction === 'backward' ? 'Backward' : 'Forward'}
    {' · '}{context.frameIndex === 0 ? 'Initial' : `Build ${context.frameIndex}`}
  </span>;
}

/** Multi-selection pins are one canonical transaction. Mixed selection pins
 * every box to its own displayed default; it never homogenizes their values. */
export function BuildFormattingKeyframe({ owners, property, label, caption }: {
  owners: Component[]; property: string; label: string; caption?: string;
}): ReactElement | null {
  const context = useContext(BuildInspectorContext);
  if (!context || !owners.length || owners.some(owner => !objectId(owner))) return null;
  const states = owners.map(owner => buildProperty(context.slide, context.frameIndex, objectId(owner)!, property));
  const allPinned = states.every(state => state.keyframed);
  const mixed = !allPinned && states.some(state => state.keyframed);
  const appearance = property !== 'visible' && owners.some(owner => isBuildAppearance(context.slide, context.frameIndex, objectId(owner)!));
  const ranges = owners.map(owner => buildEditRange(context.slide, context.frameIndex, objectId(owner)!, [property], context.direction));
  const origins = [...new Set(states.map(state => state.origin === null ? 'component default' : state.origin === 0 ? 'Initial' : `Build ${state.origin}`))];
  const explanation = property === 'content' ? 'This key includes wording and inline formatting. ' : 'This key controls the text box default; inline styles may override it. ';
  const title = `${appearance ? 'Protected by appearance: edits from other frames stop here unless Everywhere is selected. ' : ''}${explanation}${mixed ? 'Mixed keyframes. Pin all selected boxes.' : allPinned ? 'Keyframed here. Click to inherit from the preceding frame.' : `Inherited from ${origins.join(', ')}. Click to pin each box’s current default here.`} Edits affect frames ${Math.min(...ranges.map(range => range.first)) + 1}–${Math.max(...ranges.map(range => range.last)) + 1}.`;
  const control = <button type="button" className="sw-keyframe-toggle sw-formatting-keyframe"
    data-formatting-keyframe={property} data-appearance-barrier={appearance || undefined} title={title}
    aria-label={`${allPinned ? 'Inherit' : 'Keyframe'} text ${label}`} aria-pressed={mixed ? 'mixed' : allPinned}
    disabled={context.frameIndex === 0} onPointerDown={event => event.preventDefault()}
    onClick={() => context.setFormattingKeyframes(owners, property, !allPinned)}>
    <Diamond size={12} fill={allPinned ? 'currentColor' : 'none'} />{mixed && <span aria-hidden="true">−</span>}
  </button>;
  return caption ? <span className="sw-formatting-button-key">{caption}{control}</span> : control;
}

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
  const appearance = property !== 'visible' && isBuildAppearance(context.slide, context.frameIndex, id);
  const range = buildEditRange(context.slide, context.frameIndex, id, [property], context.direction);
  const origin = current.origin === null ? 'component default' : current.origin === 0 ? 'initial frame' : `build ${current.origin}`;
  const title = current.keyframed
    ? context.frameIndex === 0 ? 'Initial value: there is no preceding frame to inherit from' : 'Keyframed here. Click to inherit from the preceding frame.'
    : `Inherited from ${origin}. Click to keyframe this value here, even if unchanged.`;
  return <div className={`sw-build-property${changed ? ' sw-build-property-changed' : ''}`}
    data-build-property={property} data-keyframed={current.keyframed} data-appearance-barrier={appearance || undefined}>
    <div className="sw-build-property-content" title={`Editing affects frames ${range.first + 1}–${range.last + 1}`}>{children}</div>
    <button type="button" className="sw-keyframe-toggle" aria-label={`${current.keyframed ? 'Inherit' : 'Keyframe'} ${property}`}
      aria-pressed={current.keyframed} title={`${appearance ? 'Protected by appearance: edits from other frames stop here unless Everywhere is selected. ' : ''}${title}`} disabled={context.frameIndex === 0 && current.keyframed}
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
