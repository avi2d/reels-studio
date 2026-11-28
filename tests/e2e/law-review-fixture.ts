import { NO_EDITS, type Take } from "../../src/shared/timeline.ts"
import type { NamedText } from "../../src/web/text-names.ts"
import type { Part } from "../../src/web/studio/montage-model.ts"
import { goneDetail, partDetail, screenGroup, type PartActions, type PartData } from "../../src/web/studio/montage-part.ts"

const take: Take = { video: "voice", from: 0, to: 11, reason: "" }
const block = { id: "one", title: "Статья 900", takes: [take] as const }
const thought: NamedText = {
  name: "Надпись 1",
  part: "one",
  place: {
    state: "shown",
    planned: { id: "thought", video: "voice", from: 0, to: 11, lines: [{ text: "Статья", accent: false }, { text: "902", accent: true }] },
    shown: { id: "thought", start: 0, end: 1, lines: [] }
  }
}
const part: Part = {
  one: { block, take, spans: [{ start: 0, end: 1 }], pauses: [] },
  number: 1, length: 1, start: 0, joins: [], inserts: [], texts: [thought], zooms: [], words: []
}
const outside: NamedText = {
  name: "Надпись 2", part: undefined, place: { state: "dropped", reason: "cut", planned: {
    id: "outside", video: "voice", from: 0, to: 1, lines: [{ text: "Статья 903", accent: false }]
  } }
}
let words = "В начале этой фразы мы говорим о статье 901 а затем продолжаем говорить".split(" ").map((text, index) => ({ index, text }))
let sources: PartData["sources"] = [{ file: "law.pdf", address: "https://example.com/law", articles: ["620"] }]
const unavailable = (): never => { throw new Error("Unexpected action") }
const actions: PartActions = {
  choose: unavailable, hearTake: unavailable, hearPause: unavailable, setPause: unavailable,
  move: unavailable, remove: unavailable, restore: unavailable, showInsert: unavailable, answerInsert: unavailable,
  visualUrl: unavailable, hearJoin: unavailable, hearUnaligned: unavailable, answer: unavailable,
  cover: unavailable, pictureUrl: unavailable, hearWord: unavailable, showText: unavailable, answerText: unavailable,
  setZoom: unavailable, hearZoom: unavailable,
  fixWord: (_block, _video, index, text) => { words = words.map((word) => word.index === index ? { ...word, text } : word); render() }
}
const render = (): void => {
  const data: PartData = { count: 1, rest: 0, transcripts: new Map(), edits: NO_EDITS, pictures: [], sources, words, phraseOf: () => "", textName: () => "Надпись" }
  const withoutLaw = document.createElement("button")
  withoutLaw.id = "without-law"
  withoutLaw.textContent = "Without law"
  withoutLaw.addEventListener("click", () => { sources = []; render() })
  document.body.replaceChildren(
    partDetail(part, data, actions),
    ...screenGroup({ texts: [outside], inserts: [] }, data, actions),
    goneDetail({ ...block, id: "gone", title: "Статья 904" }, take, data, actions),
    withoutLaw
  )
}
render()
