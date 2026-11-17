import { expect, test } from "bun:test"
import { NO_EDITS, soundBlocks, withChoice, withPauses, type Block, type Blocks, type Edits } from "../../src/shared/timeline.ts"
import type { Transcript } from "../../src/shared/plan.ts"
import { playedKey, takeServer, type Loaded, type Ticket } from "../../src/web/timeline.ts"

const idle: Ticket = { changes: 5, busy: false }

const wordsA = [
  { start: 0, end: 1, text: "раз" },
  { start: 1, end: 2, text: "два" },
  { start: 4, end: 5, text: "три" }
]
const transcriptA: Transcript = { duration: 6, words: wordsA }
const transcriptB: Transcript = { duration: 2, words: [{ start: 0.5, end: 1.5, text: "ага" }] }

const takeA = { video: "a", from: 0, to: 2, reason: "clean" }
const takeB = { video: "b", from: 0, to: 0, reason: "clean" }
const first: Block = { id: "first", title: "Первый", takes: [takeA] }
const either: Block = { id: "first", title: "Первый", takes: [takeA, takeB] }

const loaded = (blocks: ReadonlyArray<Block>, names: ReadonlyArray<string>, looks: "waiting" | "measured"): Loaded => {
  const transcripts = new Map<string, Transcript>()
  if (names.includes("a")) transcripts.set("a", transcriptA)
  if (names.includes("b")) transcripts.set("b", transcriptB)
  return {
    transcripts,
    view: {
      looks: names.map((video) => ({ video, state: looks })),
      timeline: { state: "ready", blocks: [...blocks], dropped: 0, edits: NO_EDITS }
    }
  }
}

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
  const reordered = { pauses: [], chosen: [], deleted: [], order: [] }
  expect(takeServer(NO_EDITS, NO_EDITS, reordered, idle, 5, false)).toBe(true)
})

test("a measured gaze does not change the played clips", () => {
  const written: Blocks = { blocks: [{ id: "first", title: "Первый", takes: [{ video: "a", from: 0, to: 2, reason: "clean" }] }] }
  const transcripts = new Map<string, Transcript>([["a", transcriptA]])
  const before = soundBlocks(written, transcripts, new Map()).blocks
  const after = soundBlocks(written, transcripts, new Map([["a", { step: 5, samples: ["camera"] }]])).blocks
  expect(after[0]?.takes[0]).toEqual({ video: "a", from: 0, to: 2, reason: "clean", camera: 1 })
  expect(playedKey(loaded(after, ["a"], "measured"), NO_EDITS)).toBe(playedKey(loaded(before, ["a"], "waiting"), NO_EDITS))
})

test("the played content moves when a pause is removed, a take is chosen, or a video is heard", () => {
  const base = loaded([first], ["a", "b"], "measured")
  const key = playedKey(base, NO_EDITS)
  expect(playedKey(base, removedPause)).not.toBe(key)
  expect(playedKey(loaded([either], ["a", "b"], "measured"), chosenB)).not.toBe(key)
  expect(playedKey(loaded([{ id: "first", title: "Первый", takes: [takeB] }], ["a"], "measured"), NO_EDITS))
    .not.toBe(playedKey(loaded([{ id: "first", title: "Первый", takes: [takeB] }], ["a", "b"], "measured"), NO_EDITS))
})
