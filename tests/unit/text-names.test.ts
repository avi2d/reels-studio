import { expect, test } from "bun:test"
import type { TextPlace } from "../../src/shared/captions.ts"
import type { Placed } from "../../src/shared/timeline.ts"
import { whyDropped } from "../../src/web/text-drops.ts"
import { namedTexts, nameIn } from "../../src/shared/text-names.ts"

const partOf = (id: string, from: number, to: number): Placed => {
  const take = { video: "a.mov", from, to, reason: "clean" }
  return { block: { id, title: id, takes: [take] }, take, pauses: [], spans: [] }
}
const placed = [partOf("opening", 0, 3), partOf("middle", 4, 7)]
const planned = (id: string, from: number) => ({ id, video: "a.mov", from, to: from, lines: [{ text: id, accent: false }] })
const shown = (id: string, from: number, start: number): TextPlace =>
  ({ planned: planned(id, from), state: "shown", shown: { id, lines: [{ text: id, accent: false }], start, end: start + 2.5 } })

test("a dropped text in part 1 leaves «Заголовок» to the shown opening text instead of taking it", () => {
  const places: ReadonlyArray<TextPlace> = [
    { planned: planned("cut-early", 0), state: "dropped", reason: "cut" },
    shown("opening", 2, 1),
    shown("later", 5, 6)
  ]
  expect(namedTexts(places, placed, []).map(({ place, name }) => [place.planned.id, name])).toEqual([
    ["cut-early", "Мысль 1"], ["opening", "Заголовок"], ["later", "Мысль 2"]
  ])
})

test("a removed title is told as removed with «его» instead of the «её» of a key thought", () => {
  const removed: TextPlace = { planned: planned("opening", 2), state: "dropped", reason: "removed" }
  const texts = namedTexts([removed, shown("later", 5, 6)], placed, [])
  expect(texts.map(({ name }) => name)).toEqual(["Заголовок", "Мысль 1"])
  expect(whyDropped(removed, (id) => nameIn(texts, id))).toBe("Вы убрали его из ролика.")
})
