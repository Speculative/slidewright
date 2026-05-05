# Slidewright grammar

`grammar.js` is a precise specification of the brace-block DSL in
tree-sitter's declarative form. It is **documentation**, not a runtime
artifact: tree-sitter is not in the Slidewright build.

## Why hand-rolled instead of tree-sitter

See `SLIDEWRIGHT.md / Mediation layer / Parser` for the committed
position, and `HANDOFF.md / Tree-sitter investigation` for the
investigation that produced it. Short version: every primary language
toolchain that prioritizes diagnostics quality (rustc, Roslyn, the
TypeScript compiler, Clang) is hand-rolled. Tree-sitter is the SOTA for
syntax highlighting and many-grammar IDE plumbing; we have one grammar
and a stated diagnostics-quality priority, so the case for it doesn't
apply.

## How this file is used

- The runtime parser (`slidewright/runtime/parser.ts`) tracks this
  grammar. Treat divergences as bugs in either file, depending on which
  is more clearly "right" for the case at hand.
- If we ever re-open the tree-sitter question (see HANDOFF.md for
  triggers), this file is the entry point — `npx tree-sitter generate`
  produces a working parser.c from it, and the grammar uses tree-sitter
  conventions throughout.
