import { expect, test } from "bun:test"
import { NO_EDITS, type Block, type TimelinePage } from "../../src/shared/timeline.ts"
import { cutOfPage, isOpen } from "../../src/web/studio/montage-model.ts"

const misheard = "Роспотребнацере"
const transcriptsSaying = (heard: string) => new Map([["a.mov", {
  duration: 31,
  words: Array.from({ length: 31 }, (_, index) =>
    index === 6 || index === 26
      ? { start: index, end: index + 1, text: heard, sure: 0.1 }
      : { start: index, end: index + 1, text: `слово${index}`, sure: 0.99 })
}]])
const transcripts = transcriptsSaying(misheard)
const blocks: ReadonlyArray<Block> = [{
  id: "one",
  title: "Один",
  takes: [{ video: "a.mov", from: 0, to: 10, reason: "" }, { video: "a.mov", from: 20, to: 30, reason: "" }]
}]
const fix = "Роспотребнадзор"

const pageWith = (edits: typeof NO_EDITS): { readonly view: TimelinePage; readonly timeline: Extract<TimelinePage["timeline"], { readonly state: "ready" }> } => {
  const timeline = { state: "ready" as const, blocks, dropped: 0, edits, rest: 0.2 }
  const view: TimelinePage = {
    looks: [],
    faces: [],
    pictures: [],
    inserts: { state: "none" },
    texts: { state: "none" },
    doubts: { state: "ready", planned: [{ video: "a.mov", index: 6, fix, reason: "" }, { video: "a.mov", index: 26, fix, reason: "" }], dropped: 0 },
    timeline,
    gathering: false,
    gatherFailed: false
  }
  return { view, timeline }
}

test("a fix taken in one take answers the same word in the other take, not reopening a question the subtitles already show fixed", () => {
  const edits = {
    ...NO_EDITS,
    chosen: [{ block: "one", video: "a.mov", from: 20 }],
    subtitles: [{ block: "one", video: "a.mov", index: 6, text: fix }]
  }
  const { view, timeline } = pageWith(edits)
  const cut = cutOfPage(view, timeline, transcripts, edits)
  const asked = cut.questions.flatMap((question) => question.kind === "word" ? [question.place.place] : [])
  expect(asked.map((place) => [place.index, place.answer])).toEqual([[26, "fix"]])
  expect(cut.questions.filter(isOpen)).toEqual([])
})

test.each([misheard, `${misheard}.`])("a word %p left as heard in one take does not answer the same word in the other take, whatever punctuation it carries", (heard) => {
  const edits = {
    ...NO_EDITS,
    chosen: [{ block: "one", video: "a.mov", from: 20 }],
    subtitles: [{ block: "one", video: "a.mov", index: 6, text: misheard }]
  }
  const { view, timeline } = pageWith(edits)
  const cut = cutOfPage(view, timeline, transcriptsSaying(heard), edits)
  const asked = cut.questions.flatMap((question) => question.kind === "word" ? [question.place.place] : [])
  expect(asked.map((place) => [place.index, place.answer])).toEqual([[26, undefined]])
})
