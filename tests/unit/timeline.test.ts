import { expect, test } from "bun:test"
import { videoLines } from "../../src/server/chat.ts"
import { gazeText } from "../../src/server/media-commands.ts"
import type { Transcript } from "../../src/shared/plan.ts"
import {
  arrange, assemble, cameraShare, chosenTake, clipsOf, fadeGain, mergeEdits, NO_EDITS, offsetIn, pausesOf, playedSpans, soundBlocks, withChoice, withDeleted,
  withPauses, within,
  type Block, type Edits, type Gaze
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

test("a removed pause leaves 0.2 s of rest between its two words, not a cut at the word edges, and the kept pause still plays", () => {
  const edits = withPauses(NO_EDITS, [{ video: "a", after: 1 }], true)
  expect(playedSpans(first, take("a", 0, 4), edits)).toEqual([{ start: 1, end: 2.1 }, { start: 2.9, end: 6 }])
})

test("a removed pause after the last word ends the take 0.2 s after that word, not at the next take", () => {
  const edits = withPauses(NO_EDITS, [{ video: "a", after: 1 }, { video: "a", after: 4 }], true)
  expect(playedSpans(first, take("a", 0, 4), edits)).toEqual([{ start: 1, end: 2.1 }, { start: 2.9, end: 4.8 }])
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

test("the sound of a clip is silent at both cuts and full between them, not full right at the cut", () => {
  const clip = { start: 10, end: 12 }
  expect(fadeGain(clip, 10)).toBe(0)
  expect(fadeGain(clip, 10.03)).toBeCloseTo(0.5, 5)
  expect(fadeGain(clip, 11)).toBe(1)
  expect(fadeGain(clip, 11.97)).toBeCloseTo(0.5, 5)
  expect(fadeGain(clip, 12)).toBe(0)
})

test("a time in the second played span sits after only the played seconds before it, not after the removed gap too", () => {
  const spans = [{ start: 0, end: 2 }, { start: 5, end: 8 }]
  expect(offsetIn(spans, 6)).toBe(3)
  expect(offsetIn(spans, 3)).toBe(2)
  expect(offsetIn(spans, 0)).toBe(0)
})

test("a window keeps only the parts of the spans inside it, not every span it touches whole", () => {
  const spans = [{ start: 0, end: 2 }, { start: 5, end: 8 }, { start: 9, end: 10 }]
  expect(within(spans, { start: 1, end: 6 })).toEqual([{ start: 1, end: 2 }, { start: 5, end: 6 }])
})
const choice = (block: string, video: string, from: number) => ({ block, video, from })
const cut = (video: string, after: number) => ({ video, after })

test("a save keeps a picked take and the studio pauses instead of dropping one side", () => {
  const base: Edits = { ...NO_EDITS, chosen: [choice("advance", "a", 0)] }
  const local: Edits = { ...NO_EDITS, chosen: [choice("advance", "a", 0), choice("deposit", "a", 4)] }
  const current: Edits = { ...NO_EDITS, chosen: [choice("advance", "a", 0)], pauses: [cut("a", 3)] }
  expect(mergeEdits(base, local, current)).toEqual({ order: [], deleted: [], chosen: local.chosen, pauses: [cut("a", 3)], kept: [] })
})

test("returning a seen pause removes it instead of keeping the studio cut", () => {
  const base: Edits = { ...NO_EDITS, pauses: [cut("a", 3)] }
  const local: Edits = { ...NO_EDITS }
  const current: Edits = { ...NO_EDITS, pauses: [cut("a", 3)] }
  expect(mergeEdits(base, local, current).pauses).toEqual([])
})

test("a pause shortened after the last ack stays cut instead of coming back", () => {
  const base: Edits = { ...NO_EDITS, chosen: [choice("advance", "a", 0)], pauses: [cut("a", 3)] }
  const local: Edits = { ...NO_EDITS, chosen: [choice("advance", "a", 0), choice("deposit", "a", 4)], pauses: [cut("a", 3)] }
  const current: Edits = { ...NO_EDITS, chosen: [choice("advance", "a", 0)], pauses: [cut("a", 3), cut("a", 5)] }
  expect(mergeEdits(base, local, current)).toEqual({ order: [], deleted: [], chosen: local.chosen, pauses: [cut("a", 3), cut("a", 5)], kept: [] })
})

test("an undone take goes back while a later studio pause stays cut", () => {
  const base: Edits = { ...NO_EDITS, chosen: [choice("advance", "a", 2)], pauses: [cut("a", 3)] }
  const local: Edits = { ...NO_EDITS, chosen: [choice("advance", "a", 0)], pauses: [cut("a", 3)] }
  const current: Edits = { ...NO_EDITS, chosen: [choice("advance", "a", 2)], pauses: [cut("a", 3), cut("a", 5)] }
  expect(mergeEdits(base, local, current)).toEqual({ order: [], deleted: [], chosen: [choice("advance", "a", 0)], pauses: [cut("a", 3), cut("a", 5)], kept: [] })
})

test("a reorder wins the order while untouched fields stay on the server", () => {
  const base: Edits = { ...NO_EDITS, order: ["advance", "deposit"] }
  const local: Edits = { ...NO_EDITS, order: ["deposit", "advance"] }
  const current: Edits = { ...NO_EDITS, order: ["advance", "deposit"], pauses: [cut("a", 3)] }
  expect(mergeEdits(base, local, current)).toEqual({ order: ["deposit", "advance"], deleted: [], chosen: [], pauses: [cut("a", 3)], kept: [] })
})

test("returning a pause while the studio cuts another keeps both", () => {
  const base: Edits = { ...NO_EDITS, pauses: [cut("a", 3)] }
  const local: Edits = { ...NO_EDITS, kept: [cut("a", 3)] }
  const current: Edits = { ...NO_EDITS, pauses: [cut("a", 3), cut("a", 5)] }
  expect(mergeEdits(base, local, current)).toEqual({ order: [], deleted: [], chosen: [], pauses: [cut("a", 5)], kept: [cut("a", 3)] })
})
