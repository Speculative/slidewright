// Scope: the name → value lookup the DSL's `name_ref` values resolve
// against. Per SLIDEWRIGHT.md / Variables and scopes there are three
// scopes (deck, slide, template). v0.0 only ships the deck scope —
// it's enough for asset imports (`headshot: headshotImg`) and color
// tokens (`color: accent`).

export type ScopeValue = string | number | boolean | null;

export interface Scope {
  // Map of name → resolved value. The deck's `index.tsx` populates this
  // from imported assets and theme constants.
  bindings: Record<string, ScopeValue>;
}

export function emptyScope(): Scope {
  return { bindings: {} };
}

export function lookup(scope: Scope, name: string): ScopeValue | undefined {
  return scope.bindings[name];
}
