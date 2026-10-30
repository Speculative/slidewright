# Revisioned document foundation

`DeckDocument` owns source, a frozen parse result, and component occurrences for
one editing session. Complete component-local edits use bounded parsing;
uncertain boundaries and invalid input use the full parser. It does not resolve
or render components. `DeckResolver` consumes
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

## Bounded document parsing

For a valid base snapshot, each change selects the smallest strictly enclosing
component. Ancestor selections absorb nested ones; disjoint owners parse
separately. The changed component must still parse as exactly one complete
invocation covering the entire mapped slice, without diagnostics. Original
leading comments belong to the surrounding grammar and keep their attachment.
All other nodes retain their authored values while positions map to the new
source. Unchanged subtrees with unchanged positions are shared; shifted nodes
are copied so earlier snapshots stay immutable and accurate.

Initial loads, explicit replacements, top-level edits, changes without a safe
owner, invalid base snapshots and incomplete/invalid component parses use full
parsing. Fallback always publishes the ordinary parser's AST and diagnostics.
This bounds successful local parsing without inventing a second recovery grammar.

`DocumentSnapshot.parsing` reports `fullParses`, `componentParses` and
`parsedCharacters` for that revision. Characters are UTF-16 code units passed to
the parser, including failed bounded attempts before fallback. These counters
measure the document service, excluding command input/output validation and the
source editor's fold-index lexer. `npm run test:document-parsing` compares exact
ASTs/diagnostics against fresh parsing, covers raw trivia, CRLF/Unicode positions,
disjoint owners, recovery and replacements, and includes seeded arbitrary edits
and deterministic 1,000-slide work counts. Browser cache tests cover bounded
host parsing for canvas nudge/undo and source updates in 100 slides.

## Source-preserving editor commits

Custom components can opt into literal parameter write-back with
`ComponentMeta.editing: { params: ['content'] }` and call
`useComponentEditing()` from `runtime/component-editing.ts`. This capability is
independent of inspector visibility. It is available only to authored
occurrences in the active canvas; previews, SSR, and presentation are read-only.
It returns `null` when unavailable. Render controls conditionally, and stop
their pointer/key events from triggering canvas manipulation or navigation.

`updateParams(patch)` or `updateParams(current => patch)` validates all fields
before one source-preserving, build-aware transaction. The callback receives
effective literal values, including component defaults, for opted-in params.
Strings, finite numbers, booleans, and schema-matching arrays are supported;
references and structured slots are not writable through this API. An
occurrence with nonliteral opted-in values rejects updates. Unknown/unlisted
params and invalid values reject the entire patch; no-ops create no history.
Host publication and undo use the existing canvas path. A `submitted` result
means the edit was submitted to that path, not that a host has confirmed disk
persistence. The result can also be `unchanged` or `rejected` with a reason.

The capability belongs to one document revision and authoring context. Delayed
actions reject after source, slide/build, propagation direction, or editing
availability changes, even if navigation later returns to the old frame.
Components with drafts should discard them when the opaque `contextId` changes
or the capability becomes unavailable. Components do not receive source spans,
AST mutation access, or a host reference. Parameter updates do not provide
continuous previews or arbitrary structured content replacement.

Components may also opt into the existing rich-text session with
`editing: { text: {} }` and a declared `content:text-document` slot.
`useComponentEditing().editText()` opens the host-owned session; rendering the
`TextDocumentEditorContext` island mounts it in the component. A text container
marked `data-sw-text-document` also supports double-click entry. The ordinary
text selection, formatting, draft history and build text-style channels apply.
`text.mode: 'lines'` uses soft breaks for Enter, four-space Tab, and hides list
and paragraph controls. CodeDisplay and TerminalDisplay use this mode.
`text.fallbackParam` supports a legacy literal text parameter until the first
accepted edit. Migration preserves its wording channels across builds,
including equal-valued barriers and explicit content/fallback transitions.
Syntax decorations are a view over the marked document; authored foreground
color takes precedence over syntax color. No editor-engine positions are
exposed to the component.

`commitSourceEdit` captures the parsed authored tree before a command mutates it.
`SourceEditWriter` descends unchanged owners and emits only changed fragments.
Unchanged source, including comments, commas, CRLFs and string boundaries, stays
verbatim. Structural edits retain a longest ordered subsequence of authored
entries and splice only intervening gaps. Stationary slides therefore retain
occurrence handles through disjoint deletion and reorder. Moved entries receive
new handles, as with other deletion/insertion transactions.

The helper accepts an optional matching revision snapshot. Snapshot-backed
commands clone its AST for isolated mutation, then validate source splices through
the bounded document parser. Source mismatch and invalid input reject the edit;
no-ops need no output parse. Legacy callers without a snapshot still parse input
and output in full. The result includes validation work counts, the base revision,
and the validated output AST for read-only selection recovery. This output is
ephemeral validation data, never a second authoritative document.

The helper returns base-document change ranges together with recovered source
selections. Canvas commits forward these ranges and their base revision to the
host document, rejecting stale results before changing source or undo history. It validates the emitted source by reparsing and comparing the
semantic AST before publishing. A no-op creates no canvas history entry.
Direct App commands, nudging, alignment and grouping use the shared snapshot.
Grouping availability also reads that snapshot instead of reparsing during render.
Text-session startup and post-command selection recovery reuse parsed ASTs.
Clipboard reads use the matching snapshot without parsing. Element/image paste
and inspector property materialization validate through that snapshot and forward
precise changes and the base revision into canvas history and host publication.
Clipboard fragments and inspector value probes still use the real parser; their
work is bounded by the inserted content rather than the deck. Mismatched or
invalid snapshots cannot supply clipboard content or authorize a commit.
`readParserWork()` and `readEmitterWork()` expose cumulative parser character/call
and root-source emission counts. The browser nudge acceptance test subtracts
these counters across the complete application path, including command validation,
publication and UI queries: work stays below 500 parsed UTF-16 code units in 100
slides, with no root-source emission.

Run `npm run test:source-edits` for raw-source preservation, exact ranges,
structural identity and seeded sequence-edit coverage. Browser cache tests cover
canvas nudge/undo and slide insertion/deletion without rebuilding other slides.

## Canvas history ranges

Canvas history still stores source snapshots and active-slide destinations. Each
entry also stores its expected current source and precise inverse changes, in
that source's UTF-16 coordinates. Undo/redo verify this expectation and publish
those changes with the current document revision. The opposite history entry is
created by inverting the same changes, preserving disjoint ranges through repeated
cycles. Adjacent inverse ranges coalesce so adjacent deletions cannot produce
ambiguous insertions at one position. Source snapshots remain authoritative;
ranges must reproduce them exactly before an entry can be stored.

Legacy callers and scrub history without explicit ranges derive a verified
common-prefix/suffix splice. Existing external-edit barriers and slide navigation
semantics remain intact. An asynchronous host still applying the previous request
does not pop an entry whose expected source is not yet authoritative.
`npm run test:source-history` covers inversion, immutable entries, invalid ranges,
UTF-16/trivia round-trips and seeded edit cycles. Browser cache tests assert
stationary occurrence/thumbnail retention and deterministic resolution counts
through disjoint slide deletion and reorder undo/redo.

## Incremental standalone source synchronization

The standalone source pane publishes CodeMirror changes in global UTF-16 source
coordinates with the current base revision and `source-editor` origin. Scoped
slide edits advance their projection synchronously, so consecutive transactions
cannot reuse an obsolete end offset. Notes still batch decoded edits and emit a
verified splice when flushed. Incoming host authority cancels pending notes and
rejects edits from an obsolete editor projection.

Incoming source changes dispatch mapped CodeMirror transactions. Matching host
ranges remain disjoint; slide projections omit edits outside their range. A
verified common-prefix/suffix splice handles batched events, decoded notes and
hosts without precise ranges. Synchronization transactions suppress source and
cursor feedback. Selection and collapsed folds map through the changes; language,
layout and other editor state stay installed. Only the history compartment is
removed and restored to preserve existing external-edit undo barriers. Explicit
equal-source replacements also clear history. Switching projection mode or
navigating to another same-source projection creates a new editor state.

Run `npm run test:editor-changes` and `tests/incremental-editor.spec.ts` for precise
ranges, retained fields/folds, source selection mapping, feedback suppression,
history barriers, rapid scoped edits, stale projections and invalid syntax.

Folding retains lexer tokens and matched bracket pairs in CodeMirror state.
Each changed range re-lexes from a prior token boundary and expands until two
unchanged suffix tokens agree, or EOF is reached. Disjoint changes repair
independent windows. Token mergers, changed string/comment delimiters and invalid
intermediate text use the same DSL lexer; they may conservatively scan a longer
suffix. Scalar and whitespace changes map existing pairs, including single-line
pairs that may become foldable after a newline edit. Changed bracket structure
rebuilds pairs from cached tokens. Position mapping and the line lookup still
walk cached entries; this does not yet bound all folding work independently of
deck size. `readSourceFoldingWork()` reports lexical work and structure rebuilds.
`npm run test:source-folding` checks bounded lexical work in 1,000 slides and
compares folds with full lexing across delimiter edits and seeded invalid-source
sequences. Browser tests cover mapped collapsed folds and bounded lexical work.

## VS Code versioned source bridge

The webview publishes local document transactions synchronously, including exact
ranges, so canvas selection and history advance against one local source revision.
Pending sources serialize against confirmed VS Code document versions. Native
change events and request results carry versions and request IDs; own echoes
confirm progress without replaying earlier source or clearing canvas history.
Edits and undo/redo may queue before the first acknowledgement.

The extension validates each request's base version and ranges against the live
native source. It applies only those ranges through `TextEditor.edit`, whose
native document-version check also covers races during application. Each request
forms one native undo transaction. External source events forward sorted UTF-16
content changes, allowing disjoint edits to retain stationary slide identities.
Missed or invalid change information uses an explicit replacement fallback.

A rejected request, native source transformation, or competing external edit
restores authoritative source and discards queued writes as an external history
barrier. Late results cannot revive canceled writes. Canvas source selections
wait until local source is confirmed; both selection directions carry native
versions, and stale cursor/selection offsets are ignored. Revealing a native
selection rechecks its version after opening the editor.

`npm run test:vscode-source` and `test:host-document` cover versions, exact ranges,
queueing, delayed echoes, rejected writes, stale results and selection mapping.
`tests/vscode-bridge.spec.ts` mounts the real canvas, VSCodeHost and SourceSession
in a browser with a controlled native adapter, checking rapid edits and history,
rejection/races and retained slides in 100-slide decks. The native VS Code adapter
is typechecked/bundled separately; these tests do not launch a VS Code process.

Current limitations: snapshot-backed commands avoid full parsing for local edits,
but clone and compare the AST in full; document publication also walks and
relocates the AST. Top-level structural edits retain full-parse fallback. These walks remain linear
in document size; ordinary component edits localize parsing, resolution and
content rendering.
