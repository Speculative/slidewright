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
barrier, or the initial frame if there is none. Both include the selected
frame. Everywhere affects all frames, replacing keyframes only for the edited
properties, including values on hidden objects. Unrelated properties retain
their keyframes. This is the scope of one operation, not a backward
inheritance link.

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

Run the editing-model tests with `npm run test:builds`.

Presentation advances through custom component steps, authored builds, and then
slides. The presenter window shares that navigation and shows the next authored
state. PDF export offers the last authored state per slide or one page per build
including the initial frame. The final-state mode also selects the final custom
component stage; the all-build mode uses initial custom component stages on each
page. Export resolves pages independently and leaves source and editing selection
unchanged.
