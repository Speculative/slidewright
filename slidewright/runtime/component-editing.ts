import { createContext, useContext } from 'react';

/** Literal parameter updates only. References and structured slots stay opaque. */
export type EditableParam = string | number | boolean | readonly EditableParam[];
export type ParamPatch = Readonly<Record<string, EditableParam>>;
export type ParamUpdate = ParamPatch | ((current: ParamPatch) => ParamPatch);
export type ComponentEditResult = { status: 'submitted' | 'unchanged' } | { status: 'rejected'; reason: string };
export interface ComponentEditing {
  /** Opaque authoring-context token. Discard drafts when it changes. */
  readonly contextId: string;
  /** One atomic, build-aware canvas transaction. Submitted does not mean saved to disk. */
  updateParams(update: ParamUpdate): ComponentEditResult;
  editText?(): ComponentEditResult;
}
export const ComponentEditingContext = createContext<ComponentEditing | null>(null);
/** Null in read-only hosts, previews, presentation, and non-opted-in components. */
export function useComponentEditing(): ComponentEditing | null {
  return useContext(ComponentEditingContext);
}
