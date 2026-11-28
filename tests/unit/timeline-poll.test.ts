import { expect, test } from "bun:test"
import { NO_EDITS, withChoice, withManualPauses, withPauses, type Edits } from "../../src/shared/timeline.ts"
import { takeServer, type Ticket } from "../../src/web/timeline-save.ts"

const idle: Ticket = { changes: 5, busy: false }

const takeB = { video: "b", from: 0, to: 0, reason: "clean" }

const removedPause: Edits = withPauses(NO_EDITS, [{ video: "a", after: 1 }], true)
const chosenB: Edits = withChoice(removedPause, "first", takeB)

test("a poll answer that echoes the saved edits is taken, a newer server change while idle is taken", () => {
  expect(takeServer(removedPause, NO_EDITS, removedPause, idle, 5, false)).toBe(true)
  expect(takeServer(NO_EDITS, NO_EDITS, removedPause, idle, 5, false)).toBe(true)
})

test("a poll answer older than the edits on the page is kept out", () => {
  expect(takeServer(chosenB, removedPause, removedPause, idle, 5, false)).toBe(false)
  expect(takeServer(chosenB, removedPause, NO_EDITS, idle, 5, false)).toBe(false)
})

test("a poll answer that arrives while a save is running is kept out", () => {
  expect(takeServer(NO_EDITS, NO_EDITS, removedPause, idle, 5, true)).toBe(false)
})

test("a poll answer whose request started during a save is kept out", () => {
  expect(takeServer(NO_EDITS, NO_EDITS, removedPause, { changes: 5, busy: true }, 5, false)).toBe(false)
})

test("a poll answer that started before an undo is kept out", () => {
  expect(takeServer(NO_EDITS, NO_EDITS, removedPause, idle, 6, false)).toBe(false)
})

test("the edits check does not depend on the order of the fields", () => {
  const reordered = { zooms: [], inserts: [], joins: [], pauses: [], chosen: [], deleted: [], order: [], kept: [] }
  expect(takeServer(NO_EDITS, NO_EDITS, reordered, idle, 5, false)).toBe(true)
})

test("a returned pause stays out of the server check instead of being overwritten by the next poll", () => {
  const kept = withManualPauses(NO_EDITS, [{ video: "a", after: 1 }], false)
  expect(takeServer(kept, NO_EDITS, kept, idle, 5, false)).toBe(true)
  expect(takeServer(NO_EDITS, NO_EDITS, kept, idle, 5, false)).toBe(true)
  expect(takeServer(kept, NO_EDITS, NO_EDITS, idle, 5, false)).toBe(false)
})
