import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportSpeakerNotes } from '../src/speaker-notes-export.js';

test('exports notes in slide order, including all animation notes and empty steps', () => {
  const result = exportSpeakerNotes(`Deck { name: "Talk" slides: [
    Slide { label: "Opening" notes: "Hello\\nworld" }
    Slide { notes: ["Initial", "", "Last animation"] }
    Slide { }
  ] }`, 'talk.sw');
  assert.equal(result, `Talk

---

Slide 1 — Opening

Hello
world

---

Slide 2

Step 1

Initial

Step 2

(No speaker notes.)

Step 3

Last animation

---

Slide 3

(No speaker notes.)
`);
});

test('rejects invalid source instead of exporting partial notes', () => {
  assert.throws(() => exportSpeakerNotes('Deck {', 'broken.sw'), /Fix source errors/);
});
