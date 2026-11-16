import { expect, test } from "bun:test"
import { videoLines } from "../../src/server/chat.ts"
import { gazeText } from "../../src/server/media-commands.ts"
import type { Transcript } from "../../src/shared/plan.ts"
import {
  arrange, assemble, cameraShare, chosenTake, clipsOf, NO_EDITS, pausesOf, playedSpans, soundBlocks, withChoice, withDeleted, withNeighbours, withPauses,
  type Block, type Gaze
} from "../../src/shared/timeline.ts"

const word = (start: number, end: number, text: string) => ({ start, end, text })

const first: Transcript = {
  duration: 12,
  words: [
    word(1, 1.4, "Аванс"),
    word(1.4, 2, "вернут."),
    word(3, 3.5, "Аванс"),
    word(3.5, 3.8, "не"),
    word(4, 4.6, "вернут."),
    word(6, 6.6, "Задаток"),
    word(6.6, 7.2, "остаётся.")
  ]
}

const second: Transcript = { duration: 5, words: [word(0.5, 1, "Аванс"), word(1, 1.5, "вернут."), word(3, 3.5, "Спасибо.")] }
const transcripts = new Map([["a", first], ["b", second]])

const take = (video: string, from: number, to: number) => ({ video, from, to, reason: "Без запинок" })
const advance: Block = { id: "advance", title: "Аванс", takes: [take("b", 0, 1), take("a", 0, 4)] }
const deposit: Block = { id: "deposit", title: "Задаток", takes: [take("a", 5, 6)] }
const thanks: Block = { id: "thanks", title: "Спасибо", takes: [take("b", 2, 2)] }

test("silence of half a second or more inside a take is a pause, and a 0.2 s gap between words is not", () => {
  expect(pausesOf(first, take("a", 0, 4), NO_EDITS)).toEqual([
    { after: 1, start: 2, end: 3, removed: false },
    { after: 4, start: 4.6, end: 6, removed: false }
  ])
})

test("a take plays through its pauses up to the next word, not only to the end of its last word", () => {
  expect(playedSpans(first, take("a", 0, 4), NO_EDITS)).toEqual([{ start: 1, end: 6 }])
})

test("a removed pause splits the take around the silence, and the kept pause still plays", () => {
  const edits = withPauses(NO_EDITS, [{ video: "a", after: 1 }], true)
  expect(playedSpans(first, take("a", 0, 4), edits)).toEqual([{ start: 1, end: 2 }, { start: 3, end: 6 }])
})

test("a removed pause after the last word ends the take at that word, not at the next take", () => {
  const edits = withPauses(NO_EDITS, [{ video: "a", after: 1 }, { video: "a", after: 4 }], true)
  expect(playedSpans(first, take("a", 0, 4), edits)).toEqual([{ start: 1, end: 2 }, { start: 3, end: 4.6 }])
})

test("a pause removed and then returned plays again, and a pause of another video is not touched", () => {
  const removed = withPauses(NO_EDITS, [{ video: "a", after: 1 }, { video: "b", after: 1 }], true)
  expect(withPauses(removed, [{ video: "a", after: 1 }], false).pauses).toEqual([{ video: "b", after: 1 }])
})

test("the first take is chosen until the person picks another, and a pick that the block lost falls back to the first", () => {
  expect(chosenTake(advance, NO_EDITS)).toEqual(take("b", 0, 1))
  expect(chosenTake(advance, withChoice(NO_EDITS, "advance", take("a", 0, 4)))).toEqual(take("a", 0, 4))
  expect(chosenTake(advance, withChoice(NO_EDITS, "advance", take("a", 2, 4)))).toEqual(take("b", 0, 1))
})

test("blocks keep the person's order, and a block the saved order does not know stands after its neighbour, not at the end", () => {
  const edits = { ...NO_EDITS, order: ["thanks", "advance"] }
  expect(arrange([advance, deposit, thanks], edits).placed.map((block) => block.id)).toEqual(["thanks", "advance", "deposit"])
})

test("a deleted block leaves the row and comes back to its place when the deletion is undone", () => {
  const deleted = withDeleted(NO_EDITS, "deposit", true)
  const there = arrange([advance, deposit, thanks], deleted)
  expect(there.placed.map((block) => block.id)).toEqual(["advance", "thanks"])
  expect(there.deleted.map((block) => block.id)).toEqual(["deposit"])
  expect(arrange([advance, deposit, thanks], withDeleted(deleted, "deposit", false)).placed.map((block) => block.id)).toEqual(["advance", "deposit", "thanks"])
})

test("the montage plays the chosen take of each block in row order across videos, not video by video", () => {
  const edits = withChoice({ ...NO_EDITS, order: ["deposit", "advance", "thanks"] }, "advance", take("a", 0, 4))
  expect(clipsOf(assemble([advance, deposit, thanks], edits, transcripts))).toEqual([
    { video: "a", block: "deposit", start: 6, end: 12 },
    { video: "a", block: "advance", start: 1, end: 6 },
    { video: "b", block: "thanks", start: 3, end: 5 }
  ])
})

test("a take heard with its neighbours gets only the last seconds of the block before and the first seconds of the block after, not the whole blocks", () => {
  const cut = [
    { video: "a", block: "deposit", start: 6, end: 12 },
    { video: "a", block: "advance", start: 1, end: 6 },
    { video: "b", block: "thanks", start: 3, end: 5 }
  ]
  const own = [{ video: "b", block: "advance", start: 0.5, end: 1.5 }]
  expect(withNeighbours(cut, "advance", own, 1)).toEqual([
    { video: "a", block: "deposit", start: 11, end: 12 },
    { video: "b", block: "advance", start: 0.5, end: 1.5 },
    { video: "b", block: "thanks", start: 3, end: 4 }
  ])
  expect(withNeighbours(cut, "deposit", [], 4)).toEqual([{ video: "a", block: "advance", start: 1, end: 5 }])
  expect(withNeighbours(cut, "thanks", [], 4)).toEqual([{ video: "a", block: "advance", start: 2, end: 6 }])
})

const gaze: Gaze = { step: 0.5, samples: ["away", "away", "camera", "camera", "camera", "away", "hidden", "camera"] }

test("the camera share counts only the samples inside the span, and a hidden face is not a look into the camera", () => {
  expect(cameraShare(gaze, { start: 1, end: 3 })).toBe(0.75)
  expect(cameraShare(gaze, { start: 2.5, end: 3.5 })).toBe(0)
  expect(cameraShare(gaze, { start: 9, end: 10 })).toBeUndefined()
})

test("a take with word numbers the video does not have is left out and counted, and a block with no take left disappears", () => {
  const written = {
    blocks: [
      { id: "advance", title: "Аванс", takes: [take("b", 0, 1), take("a", 0, 40), take("c", 0, 1)] },
      { id: "lost", title: "Нет", takes: [take("a", 6, 5)] },
      { id: "advance", title: "Дважды", takes: [take("a", 5, 6)] }
    ]
  }
  const sound = soundBlocks(written, transcripts, new Map([["b", gaze]]))
  expect(sound.dropped).toBe(4)
  expect(sound.blocks).toEqual([{ id: "advance", title: "Аванс", takes: [{ ...take("b", 0, 1), camera: 0.5 }] }])
})

test("the gaze text for the chat model gives one share per stretch of speech with its word numbers", () => {
  const text = gazeText("b", second, gaze)
  expect(text).toContain("[0.50-1.50] words 0-1: 50%")
  expect(text).toContain("[3.00-3.50] words 2-2: 0%")
})

test("the chat model is told where the gaze file is, or to rank by speech alone while it is not measured", () => {
  const videos = [{ name: "a", state: "ready" as const, transcript: first }, { name: "b", state: "ready" as const, transcript: second }]
  const lines = videoLines(videos, {
    looks: [{ video: "a", state: "measured" }, { video: "b", state: "waiting" }],
    timeline: { state: "unreadable" }
  })
  expect(lines).toContain("gaze/a.txt")
  expect(lines).not.toContain("gaze/b.txt")
  expect(lines).toContain("rank its takes by speech alone")
  expect(lines).toContain("blocks.json is not valid")
})
