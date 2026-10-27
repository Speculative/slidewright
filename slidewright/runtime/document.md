# Revisioned document foundation

`DeckDocument` owns source, a frozen parse result, and component occurrences for
one editing session. It currently parses the full source once per accepted
transaction. It does not resolve or render components. `DeckResolver` consumes
these snapshots without reparsing them. Both built-in hosts own a persistent
document, and the interactive canvas uses a retained resolver per host session.

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
The canvas uses this cache. `tests/document-cache.spec.ts` covers 100-slide
resolution/render counts, DOM retention, source jumps and editing after position
shifts, active-slide/thumbnail retention through insertion/deletion, diagnostic
locations, replacements, and syntax recovery. Host history and draft cancellation
semantics remain owned by the existing canvas code.

## Host integration

Both hosts update their shared `Host.document` before notifying subscribers.
`HostState.documentUpdate` carries the transaction result only for that event;
late subscriptions and same-source notifications do not replay an old mapping.
The standalone host marks disk adoption, deck switching and source import as
explicit replacements. File changes are automatically replacement barriers.
VS Code messages reuse the document across edits and retain the last state for
late subscribers. Hosts without a document use a persistent canvas fallback.

`DeckDocument.updateSource` accepts optional precise change ranges and a base
revision and verifies that they produce the supplied source before publishing a
snapshot. Without ranges it derives a single common-prefix/suffix splice. This
is a conservative fallback for disjoint edits, which may retire more occurrences
than necessary. Same-source notifications do not parse or advance the revision;
explicit equal-source replacements still do. Future host/editor synchronization
will forward precise ranges instead of relying on this fallback.

Canvas source state is synchronously available to cursor notifications that
follow a source update. Selection follows retained occurrence handles, including
slot-parent identity, rather than transferring to an adjacent sibling by index.
External structural edits retain the active authored slide when possible.
Presentation state, thumbnail keys, and DOM-observer layers use the authored
slide key so index changes alone do not remount that slide.

Current limitations: editor-owned commits still often parse/emit the full deck,
and the source pane still replaces CodeMirror state for host-driven updates.
These paths need bounded authored-owner commits and incremental synchronization
before ordinary canvas edits fully meet the parent acceptance criteria.
