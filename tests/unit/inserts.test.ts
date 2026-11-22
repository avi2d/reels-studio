import { expect, test } from "bun:test"
import { insertPlaces, lookAt, shownInserts, visualKey } from "../../src/shared/inserts.ts"
import { NO_EDITS, type Clip, type Edits, type PlannedInsert } from "../../src/shared/timeline.ts"

const REEL: ReadonlyArray<Clip> = [{ video: "talk.mov", block: "one", start: 0, end: 20 }]
const TRANSCRIPTS = new Map([["talk.mov", {
  duration: 20,
  words: [
    { start: 1, end: 2, text: "Вот" },
    { start: 5, end: 6, text: "мы" },
    { start: 6, end: 8, text: "гуляем" },
    { start: 12, end: 13, text: "договор" },
    { start: 13, end: 15, text: "аренды" }
  ]
}]])

const CLIP: PlannedInsert = { id: "walk", clip: "walk.mov", start: 3, video: "talk.mov", from: 1, to: 2, reason: "Прогулка" }
const PAGE: PlannedInsert = { id: "contract", document: "contract.pdf", page: 2, quote: "не чаще раза в год", video: "talk.mov", from: 3, to: 4, reason: "Договор" }

const shownWith = (edits: Edits) => shownInserts(insertPlaces([CLIP, PAGE], REEL, TRANSCRIPTS, edits, ["photo.jpg"]), REEL, edits, ["photo.jpg"])

test("a video insert is silent unless the person turns its sound on, and not heard just because the video has sound", () => {
  const silent = shownWith(NO_EDITS).find((one) => one.id === "walk")
  expect(silent?.visual).toEqual({ kind: "clip", file: "walk.mov", start: 3, sound: false })
  const heard = shownWith({ ...NO_EDITS, inserts: [{ id: "walk", answer: "sound" }] }).find((one) => one.id === "walk")
  expect(heard?.visual).toEqual({ kind: "clip", file: "walk.mov", start: 3, sound: true })
})

test("a document insert stands at its own phrase and carries the quoted line, not the first line of the page", () => {
  const page = shownWith(NO_EDITS).find((one) => one.id === "contract")
  expect(page).toEqual({ id: "contract", visual: { kind: "page", file: "contract.pdf", page: 2, quote: "не чаще раза в год" }, start: 12, end: 15 })
})

test("a video insert plays from the moment the plan names, not from the clip's start, and does not drift closer like a picture", () => {
  const look = lookAt(shownWith(NO_EDITS), 6)
  expect(look?.since).toBe(1)
  expect(look?.scale).toBe(1)
})

test("a video insert the person replaces with a picture becomes that picture, not a silent clip", () => {
  const shown = shownWith({ ...NO_EDITS, inserts: [{ id: "walk", answer: "replace", picture: "photo.jpg" }] })
  expect(shown.find((one) => one.id === "walk")?.visual).toEqual({ kind: "picture", file: "photo.jpg" })
})

test("a silent clip and the same clip with its sound on are two different cuts, so the reel is built again after the change", () => {
  expect(visualKey({ kind: "clip", file: "walk.mov", start: 3, sound: false })).not.toBe(visualKey({ kind: "clip", file: "walk.mov", start: 3, sound: true }))
  expect(visualKey({ kind: "picture", file: "photo.jpg" })).toBe("photo.jpg")
})
