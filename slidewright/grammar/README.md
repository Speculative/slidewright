# Slidewright grammar

`grammar.js` is a precise specification of the brace-block DSL in
tree-sitter's declarative form. It is **documentation**, not a runtime
artifact: tree-sitter is not in the Slidewright build.

## Why hand-rolled instead of tree-sitter

See [SLIDEWRIGHT.md — Parser](../../SLIDEWRIGHT.md#parser)
for the architecture and rationale. Slidewright uses one grammar and prioritizes contextual diagnostics; tree-sitter's multi-grammar
plumbing is not currently needed. The earlier investigation remains in git
history (`0790967` and earlier).

## How this file is used

- The runtime parser (`slidewright/runtime/parser.ts`) tracks this
  grammar. Treat divergences as bugs in either file, depending on which
  is more clearly "right" for the case at hand.
- If a tree-sitter implementation is needed, this file is the entry point.
  `npx tree-sitter generate` produces a parser.c from it; the grammar uses
  tree-sitter conventions throughout.
