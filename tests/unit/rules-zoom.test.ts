import { expect, test } from "bun:test"
import { rulesView } from "../../src/shared/rules.ts"
import { NO_EDITS, type Block } from "../../src/shared/timeline.ts"

test("a rule change excludes a zoom dropped because the next starts too soon", () => {
  const blocks = [{ id: "one", title: "Part", takes: [{ video: "a", from: 0, to: 1, reason: "" }] }] satisfies ReadonlyArray<Block>
  const transcripts = new Map([["a", { duration: 8, words: [{ start: 6, end: 6.3, text: "first" }, { start: 6.35, end: 6.6, text: "second" }] }]])
  const zooms = [{ id: "one", video: "a", from: 0, to: 0 }, { id: "two", video: "a", from: 1, to: 1 }]
  const rules = { pause: 0.2, zoom: "full" as const }
  const cut = { blocks, edits: NO_EDITS, transcripts, zooms, faces: [] }
  const change = rulesView(rules, {}, { before: { zoom: "soft" }, after: rules }, cut).changes[0]
  expect(change?.id).toBe("zoom")
  if (change?.id !== "zoom") throw new Error("zoom change missing")
  expect(change.zooms).toEqual([{ block: "Part", words: "second" }])
})
