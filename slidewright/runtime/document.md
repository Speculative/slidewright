# Revisioned document foundation

`DeckDocument` owns source, a frozen parse result, and component occurrences for
one editing session. It currently parses the full source once per accepted
transaction. It does not resolve or render components. `DeckResolver` consumes
these snapshots without reparsing them; the canvas host subscription still uses
the one-shot `loadDeck` path and will migrate in the next integration slice.

A transaction names its base revision and origin and supplies sorted,
non-overlapping changes in base-document UTF-16 coordinates. Invalid requests
throw before changing the current snapshot. Syntax errors in otherwise valid
transactions are accepted: the new source and parser diagnostics become the
current revision. Snapshots cannot be mutated, including through AST objects.
Editor commands will need to clone the authored owner they edit.

Handles identify component occurrences within this document session. Mapping
preserves handles when an occurrence's name and mapped boundaries survive.
Changing a component's interior preserves its handle. A deleted or completely
replaced occurrence retires its handle; a new occurrence always receives a fresh
handle. Reordering via deletion/insertion therefore gives the moved occurrence a
fresh handle while preserving stationary neighbors. No text-based deduplication
or DSL IDs are involved. Explicit host replacements retire all handles, including
same-source replacements; changing the file requires this barrier.

The update reports changed and retired handles, the affected authored owners
(explicit, or inferred as the smallest enclosing components), and a mapping
between the two named revisions. `changed` compares each occurrence's authored
source, so enclosing components also change. It is not a dependency graph:
shared tokens, registry entries and assets need conservative invalidation in the
resolution cache. Chapter/order/frame metadata must also be handled there.

Mappings return null for deleted interior positions and full replacement
barriers. Left/right affinity selects the side of inserted text at a boundary.
Ranges attach their start to the right and end to the left, excluding adjacent
insertions. Consumers should resolve an occurrence handle again in the current
snapshot instead of retaining its obsolete global span. Cache diagnostics and
other locations relative to a slide handle, then use `locate` to obtain current
global UTF-16 offsets and 1-based line/column locations. A content change still
requires recomputing that slide's cached diagnostics.

This service does not own undo, cancel drafts, or subscribe to hosts. Integration
must preserve existing external history barriers and draft cancellation, pass
source-editor change ranges, and turn transaction results into source selections.
Fallback whole-source replacements must explicitly choose whether they represent
a history/identity barrier or an ordinary mapped edit.

Run `npm run test:document` for deterministic revision, identity, mapping, recovery,
and 1,000-slide regression coverage. Browser acceptance tests belong with the
subsequent canvas and host integrations.

## Retained slide resolution

`DeckResolver.resolve(document, { components, scope, wrapShape })` returns the
usual deck result plus its document revision. `loadDeck` remains the one-shot
parse/resolve adapter for CLI, SSR and other independent callers.
`resolveParsedDeck` is the underlying read-only parsed-input adapter.

The resolver caches by occurrence handle and exact authored slide source.
Registry render/meta/adapter references, scope values, the wrapper function, and
resolved source tokens conservatively invalidate the cache. Registry entries
must be treated as immutable; call `invalidate()` after an in-place mutation.
An explicit document replacement has new handles and therefore new cache entries.
Any parser/lexer error bypasses and clears retained resolution: recovery nodes
can have truncated spans that cannot safely own relative diagnostics.

Cache hits retain the resolved content React element. Frame order and inherited
chapter metadata are composed separately. Diagnostics and shape registries expose
current global locations and current-revision AST components. Bound adapters are
rebound to current child locations without resolving their slide again. The
`SourceLocationContext` relocates the cached content's DOM source markers and
canvas projections without changing the content element identity. Canvas
projections memoize the component render element so source-location-only updates
do not re-render component content. Inline editor resolutions use current absolute locations and reset the location
context accordingly. Preview consumers resolving current absolute locations must
also reset that context.
Custom wrappers used with retained resolution must consume this context for
source-bearing props, as `ShapeProjection` does; the default wrapper already does.

`DeckResolver.stats` exposes deterministic per-call resolved/reused slide counts.
Run `npm run test:slide-cache` for identity, source-target/diagnostic parity with
fresh loading, invalidation, structural edits, recovery, and bound-adapter tests.
The canvas is not yet wired to this cache; browser remount/render-count acceptance
must accompany that integration. Host history and draft cancellation semantics
remain owned by the existing canvas code.
