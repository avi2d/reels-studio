import { expect, test } from "bun:test"
import type { TextPlace } from "../../src/shared/captions.ts"
import { textList } from "../../src/web/timeline-texts.ts"

interface Drawn {
  readonly tag: string
  readonly attributes: Record<string, string>
  readonly kids: Array<Drawn | string>
}

const drawn = (tag: string): Drawn => {
  const node: Drawn = { tag, attributes: {}, kids: [] }
  return Object.assign(node, {
    setAttribute: (name: string, value: string) => { node.attributes[name] = value },
    addEventListener: () => {},
    append: (...kids: Array<Drawn | string>) => { node.kids.push(...kids) }
  })
}

Object.assign(globalThis, { document: { createElement: drawn } })

const isDrawn = (value: unknown): value is Drawn =>
  typeof value === "object" && value !== null && "tag" in value && typeof value.tag === "string" &&
  "attributes" in value && typeof value.attributes === "object" && "kids" in value && Array.isArray(value.kids)

const linesIn = (node: Drawn | string): ReadonlyArray<string> => typeof node === "string" ? [node] : node.kids.flatMap(linesIn)
const itemsIn = (node: Drawn): ReadonlyArray<Drawn> => node.kids.flatMap((kid) => typeof kid === "string" ? [] : kid.tag === "li" ? [kid] : itemsIn(kid))

const planned = (id: string, video: string) => ({ id, video, from: 0, to: 0, lines: [{ text: id, accent: false }] })
const dropped = (id: string, reason: Extract<TextPlace, { state: "dropped" }>["reason"]): TextPlace => ({ planned: planned(id, "a.mov"), state: "dropped", reason })

const render = (places: ReadonlyArray<TextPlace>, state: "ready" | "unreadable" = "ready"): Drawn => {
  const view = state === "ready" ? { state, planned: places.map((place) => place.planned) } : { state }
  const [list]: ReadonlyArray<unknown> = textList({ planned: view, places, phraseOf: () => "Аванс" })
  if (!isDrawn(list)) throw new Error("no key thought list")
  return list
}

test("a broken texts.json says the key thoughts did not read instead of drawing an empty list", () => {
  const text = linesIn(render([], "unreadable")).join("\n")
  expect(text).toContain("Ключевые мысли не прочитались")
  expect(text).not.toContain("Ключевых мыслей нет")
})

test("each dropped key thought names itself and gives its own reason instead of disappearing from the list", () => {
  const places = [
    { ...dropped("Видео", "unknown-video"), planned: planned("Видео", "b.mov") },
    dropped("Слова", "out-of-range"),
    dropped("Вырезано", "cut")
  ]
  const items = itemsIn(render(places))
  expect(items).toHaveLength(3)
  const texts = items.map((item) => linesIn(item))
  expect(texts.map((lines) => lines[0])).toEqual(["Мысль 1 не встанет в ролик", "Мысль 2 не встанет в ролик", "Мысль 3 не встанет в ролик"])
  expect(texts.map((lines) => lines[1])).toEqual(["«Видео»", "«Слова»", "«Вырезано»"])
  const reasons = texts.map((lines) => lines.at(-1) ?? "")
  expect(new Set(reasons).size).toBe(3)
  expect(reasons[0]).toContain("«b.mov»")
  expect(reasons[2]).toContain("нет в ролике")
})

test("the count forecasts how many key thoughts will not go into the reel, not that every thought is shown", () => {
  const shown: TextPlace = { planned: planned("Есть", "a.mov"), state: "shown", shown: { id: "Есть", lines: [{ text: "Есть", accent: false }], start: 0, end: 2.5 } }
  const text = linesIn(render([shown, dropped("Вырезано", "cut")])).join("\n")
  expect(text).toContain("Не встанут в ролик: 1 из 2.")
  expect(text).not.toContain("Встанут в ролик: 2.")
})
