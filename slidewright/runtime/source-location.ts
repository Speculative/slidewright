// Cached slide content keeps the source coordinates of the revision in which
// it resolved. Only marker/projection consumers subscribe to the current frame
// location; component content and resolved slots can keep their React identity.
import { createContext, createElement, useContext, type ReactElement, type ReactNode } from 'react';
import type { Component } from './ast.js';

export interface SourceLocation {
  readonly delta: number;
  readonly components: ReadonlyMap<number, Component>;
  readonly adapters: ReadonlyMap<number, unknown>;
}
export const SourceLocationContext = createContext<SourceLocation | null>(null);

export function useSourceComponent(component: Component): Component {
  const location = useContext(SourceLocationContext);
  return location?.components.get(component.span.start.offset + location.delta) ?? component;
}

export function useSourceAdapter(component: Component, fallback: unknown): unknown {
  const location = useContext(SourceLocationContext);
  return location?.adapters.get(component.span.start.offset) ?? fallback;
}

function SourceElement({ tag, attributes, children }: {
  tag: string;
  attributes: Record<string, unknown>;
  children?: ReactNode;
}): ReactElement {
  const location = useContext(SourceLocationContext);
  const props = { ...attributes };
  delete props.key;
  if (location?.delta) {
    for (const [name, value] of Object.entries(props)) {
      if (typeof value === 'number' && /^data-sw-(?:span|text-span|slot-span|slot-parent)-(?:start|end)$/.test(name)) {
        props[name] = value + location.delta;
      }
    }
  }
  return createElement(tag, props, children);
}

export function sourceElement(tag: string, attributes: Record<string, unknown>, ...children: ReactNode[]): ReactElement {
  // Keep authored metadata visible on the element as well as the DOM: hosts
  // inspect top-level slide props for source-cursor navigation before rendering.
  return createElement(SourceElement, { ...attributes,
    key: attributes.key as string | number | undefined, tag, attributes,
  }, ...children);
}
