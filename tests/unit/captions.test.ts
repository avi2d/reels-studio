import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { BunFileSystem } from "@effect/platform-bun"
import { Effect } from "effect"
import { filterPath, inkOf, readCaptions, readTexts } from "../../src/server/captions.ts"
import { fitWord, NO_CAPTIONS, shownTexts, textPlaces } from "../../src/shared/captions.ts"
import { readApproval } from "../../src/server/approval.ts"
import { NO_EDITS, type Block } from "../../src/shared/timeline.ts"

test("a long subtitle word shrinks instead of reaching under the Instagram button column", () => {
  const word = { text: "высокопрофессиональный", start: 0, end: 1 }
  const fitted = fitWord(word, { left: 148, right: 932, top: 1412, bottom: 1486 })
  const size = fitted.size ?? 78
  expect(size).toBeGreaterThan(0)
  expect(size).toBeLessThan(78)
  expect(540 + 783 * size / 78 / 2).toBeLessThanOrEqual(865)
  expect(540 - 783 * size / 78 / 2).toBeGreaterThanOrEqual(100)
  expect(fitted.text).toBe(word.text)
  expect([fitted.start, fitted.end]).toEqual([0, 1])
})

test("a subtitle word whose ink fits comes back unchanged instead of shrinking", () => {
  const word = { text: "слово", start: 0, end: 1 }
  expect(fitWord(word, { left: 400, right: 680, top: 1412, bottom: 1486 })).toBe(word)
})

test("changed or newly added text cannot reach captions under an older approval", async () => {
  await mkdir("node_modules/.cache", { recursive: true })
  const dir = await mkdtemp("node_modules/.cache/caption-approval-")
  const texts = JSON.stringify({ texts: [{ id: "a", video: "a.mov", from: 0, to: 0, lines: [{ text: "Аванс", accent: false }] }] })
  const approval = { plan: "план", texts, at: "2026-11-20T10:00:00.000Z", done: [] }
  const clips = [{ block: "a", video: "a.mov", start: 0, end: 3 }]
  const transcripts = new Map([["a.mov", { duration: 3, words: [{ text: "Аванс", start: 0, end: 1 }] }]])
  const read = () => Effect.runPromise(readCaptions(dir, clips, transcripts, [], NO_EDITS).pipe(Effect.provide(BunFileSystem.layer)))
  const state = async () => (await Effect.runPromise(readApproval(dir).pipe(Effect.provide(BunFileSystem.layer)))).plan.state
  try {
    await writeFile(`${dir}/plan.md`, "план")
    await writeFile(`${dir}/texts.json`, texts)
    await writeFile(`${dir}/approval.json`, JSON.stringify(approval))
    expect((await read()).texts[0]?.lines[0]?.text).toBe("Аванс")
    expect(await state()).toBe("approved")
    await writeFile(`${dir}/texts.json`, texts.replace("Аванс", "Задаток"))
    expect(await read()).toEqual(NO_CAPTIONS)
    expect(await state()).toBe("proposed")
    await rm(`${dir}/texts.json`)
    expect(await read()).toEqual(NO_CAPTIONS)
    expect(await state()).toBe("proposed")
    await writeFile(`${dir}/approval.json`, JSON.stringify({ ...approval, texts: null }))
    expect((await read()).words).toHaveLength(1)
    expect(await state()).toBe("approved")
    await writeFile(`${dir}/texts.json`, texts)
    expect(await read()).toEqual(NO_CAPTIONS)
    expect(await state()).toBe("proposed")
    await writeFile(`${dir}/approval.json`, JSON.stringify({ plan: approval.plan, at: approval.at, done: [] }))
    expect(await read()).toEqual(NO_CAPTIONS)
    expect(await state()).toBe("proposed")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("the built subtitles carry a stored word correction instead of the transcript spelling", async () => {
  await mkdir("node_modules/.cache", { recursive: true })
  const dir = await mkdtemp("node_modules/.cache/caption-correction-")
  const clips = [{ block: "a", video: "a.mov", start: 0, end: 3 }]
  const transcripts = new Map([["a.mov", { duration: 3, words: [{ text: "А", start: 0, end: 1 }, { text: "вас", start: 1, end: 2 }, { text: "тоже", start: 2, end: 3 }] }]])
  const blocks: ReadonlyArray<Block> = [{ id: "a", title: "a", takes: [{ video: "a.mov", from: 0, to: 2, reason: "" }] }]
  const edits = { ...NO_EDITS, subtitles: [{ block: "a", video: "a.mov", index: 1, text: "вашим" }] }
  try {
    await writeFile(`${dir}/plan.md`, "план")
    await writeFile(`${dir}/approval.json`, JSON.stringify({ plan: "план", texts: null, at: "2026-11-20T10:00:00.000Z", done: [] }))
    const captions = await Effect.runPromise(readCaptions(dir, clips, transcripts, blocks, edits).pipe(Effect.provide(BunFileSystem.layer)))
    expect(captions.words.map((word) => word.text)).toEqual(["А", "вашим", "тоже"])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("a folder name with a comma, a quote, a colon or brackets cannot end the filter or start an option", () => {
  expect(filterPath("/a b/it's: [x];y,z")).toBe(String.raw`/a b/it\\\'s\\: \[x\]\;y\,z`)
})

test("the ink box counts its right and bottom edges as outside, so a box at the frame edge is not cut short by a pixel", () => {
  const line = "[Parsed_bbox_1 @ 0x70cb9c004800] n:1 pts:1 pts_time:0.2 x1:478 x2:602 y1:1621 y2:1666 w:125 h:46 crop=125:46:478:1621 drawbox=478:1621:125:46"
  expect(inkOf(`noise\n${line}\n`)).toEqual([{ at: 0.2, rect: { left: 478, top: 1621, right: 603, bottom: 1667 } }])
})

const said = {
  duration: 4,
  words: [
    { text: "Аванс", start: 0, end: 1 },
    { text: "тридцать", start: 1, end: 2 },
    { text: "процентов", start: 2, end: 3 },
    { text: "сразу", start: 3, end: 4 }
  ]
}
const heard = new Map([["a.mov", said]])
const withoutPercent = [{ block: "a", video: "a.mov", start: 0, end: 2 }, { block: "a", video: "a.mov", start: 3, end: 4 }]
const thought = (id: string, video: string, from: number, to: number) => ({ id, video, from, to, lines: [{ text: id, accent: false }] })
const reasons = (planned: ReadonlyArray<ReturnType<typeof thought>>) =>
  textPlaces(planned, withoutPercent, heard).map((place) => place.state === "shown" ? place.state : place.reason)

test("a broken texts.json reads as unreadable rather than as a project without key thoughts", async () => {
  await mkdir("node_modules/.cache", { recursive: true })
  const dir = await mkdtemp("node_modules/.cache/caption-broken-")
  const broken = "{\"texts\": [{\"id\": \"a\""
  try {
    await writeFile(`${dir}/plan.md`, "план")
    await writeFile(`${dir}/texts.json`, broken)
    await writeFile(`${dir}/approval.json`, JSON.stringify({ plan: "план", texts: broken, at: "2026-11-20T10:00:00.000Z", done: [] }))
    expect(await Effect.runPromise(readTexts(dir).pipe(Effect.provide(BunFileSystem.layer)))).toEqual({ state: "unreadable" })
    await rm(`${dir}/texts.json`)
    expect(await Effect.runPromise(readTexts(dir).pipe(Effect.provide(BunFileSystem.layer)))).toEqual({ state: "none" })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("a key thought on a video the project does not hold is marked unknown-video instead of vanishing", () => {
  expect(reasons([thought("a", "b.mov", 0, 0)])).toEqual(["unknown-video"])
})

test("a key thought whose word numbers fall outside its transcript or run backwards is marked out-of-range instead of vanishing", () => {
  expect(reasons([thought("a", "a.mov", 2, 7), thought("b", "a.mov", -1, 0), thought("c", "a.mov", 3, 1)])).toEqual(["out-of-range", "out-of-range", "out-of-range"])
})

test("a key thought whose phrase the cut removed is marked cut instead of vanishing", () => {
  expect(reasons([thought("a", "a.mov", 2, 2)])).toEqual(["cut"])
})

test("a key thought with only blank lines, or wholly under the one before it, is marked instead of vanishing", () => {
  const blank = { ...thought("a", "a.mov", 0, 0), lines: [{ text: "  ", accent: true }] }
  expect(reasons([blank])).toEqual(["empty"])
  expect(reasons([thought("a", "a.mov", 1, 1), thought("b", "a.mov", 3, 3)])).toEqual(["shown", "covered"])
})

test("a key thought kept beside dropped ones stands from its first word for 2.5 s, not shifted by the dropped ones", () => {
  const planned = [thought("gone", "b.mov", 0, 0), thought("kept", "a.mov", 0, 0), thought("cut", "a.mov", 2, 2)]
  expect(shownTexts(planned, withoutPercent, heard)).toEqual([{ id: "kept", lines: [{ text: "kept", accent: false }], start: 0, end: 2.5 }])
})
