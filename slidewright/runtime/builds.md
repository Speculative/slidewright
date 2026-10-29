# Discrete build model

The source-backed model is implemented in `builds.ts`; the loader consumes it
through `LoadDeckInput.buildIndices` and retains authored/effective slide data
separately. Canvas transactions lower effective scene edits back into canonical
source. The standalone editor supports frame controls, property keyframes,
directional edits, presenter previews, and PDF export.

To try it, open `/canvas.html?deck=uist-2026`, select a slide, and click **Add
build**. Select an indented frame and edit through the canvas, inspector, or
text toolbar. Changes propagate forward by default. Switch **Forward / Backward / Everywhere**
(or press **Alt+Shift+B**) before the next edit to change its scope. Everywhere
replaces keyframes for edited properties across all frames. Alignment and
distribution compute one layout from the displayed selection and apply the
affected coordinates everywhere, including stationary anchors and hidden frames.

Use each property's diamond to pin its current value as a barrier, even when
it has not changed. Click a filled diamond to resume preceding-frame
inheritance. TextBox typography/content pins are also available in the
collapsible **Additional property keyframes** panel. Visibility and opacity
remain editable in the main inspector. Hidden objects remain in
the hierarchy and can be restored through **Hidden objects**. To make a return
state, duplicate a frame, pin the properties to restore, and move it after the
temporary emphasis frame with **Move build up/down**.

The selected-text-box toolbar exposes diamonds beside font, size, foreground
color, bold weight, line height and letter spacing. Multi-selection shows mixed
keys; clicking a mixed diamond pins each box's own value in one transaction.
Pin/unpin remains local regardless of propagation direction. Initial values
cannot inherit from a preceding frame. Enter can reapply an unchanged displayed
value, allowing Everywhere to remove other builds' overrides without a temporary
value change. Merely focusing/blurring a field does not reapply it.

Whole-box typography properties have independent propagation barriers. An edit
also clears that property's inline overrides in each affected text variant,
preserving wording, lists, links, other formatting and explicit content pins.
`transformBuildProperty` transforms existing value segments over a specified
range and restores values beyond it; it does not broadcast one content value
over different wording variants. The source transaction includes these content
changes and any restoration keys in the same undo as the typography edit.

Phrase styles now use independent owner/run/property keys, separate from wording.
The rich-text toolbar shows inherited, keyed and mixed range diamonds; pin/unpin
is local, while value edits follow Forward / Backward / Everywhere and appearance
boundaries. Cancel discards the draft; Done commits identities, wording, style
keys and box defaults as one canvas undo.

```sw
Build {
  id: "emphasis"
  changes: []
  textStyles: [TextStyle { target: "text" run: "phrase" color: red }]
}
```

`Slide.textStyles` owns initial styles and `Build.textStyles` later keys. A
`TextStyle` targets a scene owner ID and a persistent `Span.runId`; its fields
include color, font, size, weight, spacing, stroke, italic, underline,
strikethrough and links. An absent field inherits; `omit` resets to the box's
default. Independent channels cross content and other style keys. Whole-box
scalar typography clears the corresponding independent channel over its edit
range, preserving other channels and restoring the following boundary.

For example, coloring “print” red in Build 1 does not author a content key.
Changing Initial's “debugging” to “logging” then produces red “print logging”
in Build 1. Typing in Build 1 still creates a complete-content wording key:
earlier wording changes stop there. No operational transform or text merging
is performed. The **Text & inline styles** diamond still pins that complete
content value; paragraph/list formatting and whole-box italic, underline,
strike and stroke commands use that content path.

### Text-run identity foundation

Build text sessions now prepare persistent identities in a private draft and
save them only with an accepted edit. Unchanged sessions and cancellation do
not materialize IDs. Existing identified content retains identities through
other text projection paths, including whole-box formatting.

```sw
Span { runId: "run-1" content: "print debugging" }
```

`Span.runId` identifies a text segment within its owning text document. It is
distinct from scene object `id`; the style target is the owner/run
pair. String references and opaque inline elements remain atomic, and custom
owned editor internals are not traversed. Transparent content slots retain
their editable children. These identities do not change rendering.

The identity rule follows the editor's text/style continuity, rather than fixed
original characters: correcting `print` to `printf` retains the segment's ID.
Partial formatting and paragraph splits keep the first fragment's ID, allocate
fresh IDs to subsequent fragments, and report their split ancestry. Joining
paragraphs retains distinct surviving run IDs. Full deletion reports the lost
IDs without attaching them to neighboring text. Native clipboard HTML does not
serialize session provenance, so pasted text gets fresh run identities.
Deletion is local to the edited variant: keys remain dormant while another
authored variant uses their target. Only globally unused targets are pruned.

`TextRunIdentity` in `text-runs.ts` provides engine-independent preparation and
reconciliation. `TextProjection.preparedContent` and `runChanges` expose the
prepared AST and added/removed/split IDs for subsequent transaction lowering.
Repeated lowering of one draft is deterministic. Duplicate authored run IDs in
one document are rejected, rather than guessing which target they identify.
Allocation reserves IDs from all of the owner's authored build variants, so
editing an unidentified earlier variant cannot accidentally reuse an identity
already assigned to an unrelated later fragment. Equal wording alone does not
establish identity between independently authored variants.

`text-build-edit.ts` lowers accepted drafts, copies style keys using split
ancestry, and materializes formatting fragments across matching identified
wording variants. It does not infer shared identity from equal wording or split
a differently worded variant by guessed character offsets. `text-builds.ts`
resolves style keys after wording, validates targets, and handles independent
propagation, pinning and cleanup. Duplicate and reorder carry authored style
keys with their build; delete removes those keys and recomputes inheritance.
Build difference feedback includes effective phrase-style changes.

Builds are instantaneous states in this version: visibility changes appear or
disappear, and position/style changes jump. Grouping, reparenting, and scene
child reordering are unavailable on slides with builds; arrange those structural
relationships before adding builds. Moving/resizing objects, inserting them,
editing text/style, and hiding/restoring them are supported. Insertion and
removal begin at the selected frame and propagate forward. Slide labels, notes,
and chrome remain owned by the slide.

```sw
Slide {
  content: Freeform {
    id: "diagram"
    children: [
      Box { id: "node" x: 100 y: 20 width: 200 height: 100 }
    ]
  }
  builds: [
    Build {
      id: "focus"
      label: "Focus"
      changes: [Change { target: "node" x: 250 }]
    }
    Build {
      id: "return"
      changes: [Change { target: "node" x: 100 }]
    }
  ]
}
```

The slide content defines the initial frame (index zero). Each subordinate
`Build` owns a list of `Change` components. Each change targets one stable
object ID and supplies property keyframes. IDs are unique within the slide;
duplicating a build retains the scene's object identities. There is no
separate shared-value layer.

An absent property in a change inherits from preceding frames. An explicit
property remains a barrier even if its value equals the inherited value.
`omit` explicitly returns a property to its component default; it differs
from removing that property's keyframe. Initial authored values have no
preceding frame to inherit from and cannot be unpinned through the model.

`editBuildProperties` accepts an object ID, the selected frame, one or more
property values, and a direction. Forward is the default. Forward edits
affect the selected frame through the frame before the next explicit barrier.
Backward edits affect the selected frame back to the frame after the previous
barrier. Both include the selected
frame. Everywhere affects all frames, replacing keyframes only for the edited
properties, including values on hidden objects. Unrelated properties retain
their keyframes. This is the scope of one operation, not a backward
inheritance link.

An object's appearance implicitly protects **all non-visibility properties**,
including component defaults and content. Forward stops before the next
appearance; Backward from a later frame stops before the preceding appearance.
Editing an appearance itself may change it but does not extend backward into
the hidden interval. An initially visible object appears in the initial frame,
so Backward from a later build preserves that initial appearance. Use Everywhere
to revise the complete diagram across these boundaries.

Appearance means a hidden-to-visible transition, including reappearance and
reveals caused by ancestors. A redundant `visible: true` pin is not an
appearance. Visibility edits continue to use their own explicit property keys
so insertion/hiding/restoration can still change the reveal sequence.
No copy of every property is authored at reveal time: crossed edits preserve
the boundary's prior value as needed. Diamonds show appearance protection with
a green outline and tooltip, separately from explicit filled pins. Removing
an explicit property pin does not remove the appearance boundary. This rule
also applies to existing source-backed builds without a source migration;
it cannot reconstruct values overwritten by an earlier edit.

In Forward/Backward, grouped properties share a range bounded by any member's keyframe. Values
outside that range remain unchanged. The operation authors restoration
keyframes at the following boundary where necessary; these must remain
visible to the user and be part of the same source undo operation. Without a
shared-value concept, restoring a value means an explicit keyframe, not a
live reference to an earlier frame.

`toggleBuildKeyframe` operates locally, independently of editing direction.
Pinning captures the current value (or a supplied schema default); unpinning
removes that frame's property and resumes preceding-frame inheritance.

`visible` defaults to true. A later insertion can be represented by an object
with initial `visible: false` and a `visible: true` keyframe. Hide and restore
keep the same object ID, and other properties continue resolving while hidden.
Hidden objects are removed from layout; opacity is a distinct property that
preserves layout space. The loader retains hidden shape data for authoring.

Add inserts an empty diff after the selected frame. Duplicate copies the
selected frame's authored changes; duplicating the initial frame captures its
authored nonstructural properties as return-state keyframes. Pin additional
default-valued properties before moving the duplicate when those values should
also be restored. Reorder moves authored changes; delete removes them. Both
recompute subsequent inheritance. The initial frame cannot be moved or deleted.

`resolveBuild` returns a detached scene projection without changing authored
nodes. Components retain their owner source spans; keyframed values retain
their value source spans. Editor integration applies gestures to effective
values before lowering edits through this model. Mutating the initial values
and then diffing rendered scenes is insufficient: an existing keyframe can
mask the mutation, and a relative drag would start at the wrong position.

`validateBuilds` checks identity and metadata structure. Registry-aware schema
validation and diagnostics for individual keyframed values belong in loader
integration. `buildDifferences` reports authored-value differences from the
preceding frame and accepts a schema-default resolver so equal-valued default
pins remain barriers without being highlighted as visual changes.

Run the editing-model tests with `npm run test:builds` and
`npm run test:text-runs` (both included in `npm test`).

Presentation advances through custom component steps, authored builds, and then
slides. The presenter window shares that navigation and shows the next authored
state. PDF export offers the last authored state per slide or one page per build
including the initial frame. The final-state mode also selects the final custom
component stage; the all-build mode uses initial custom component stages on each
page. Export resolves pages independently and leaves source and editing selection
unchanged.
