import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { BunFileSystem } from "@effect/platform-bun"
import { Effect } from "effect"
import { filterPath, inkOf, readCaptions } from "../../src/server/captions.ts"
import { fitWord, NO_CAPTIONS } from "../../src/shared/captions.ts"
import { readApproval } from "../../src/server/approval.ts"

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

test("a subtitle word that fits keeps its normal size instead of shrinking with a longer neighbour", () => {
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
  const read = () => Effect.runPromise(readCaptions(dir, clips, transcripts).pipe(Effect.provide(BunFileSystem.layer)))
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

test("a folder name with a comma, a quote, a colon or brackets cannot end the filter or start an option", () => {
  expect(filterPath("/a b/it's: [x];y,z")).toBe(String.raw`/a b/it\\\'s\\: \[x\]\;y\,z`)
})

test("the ink box counts its right and bottom edges as outside, so a box at the frame edge is not cut short by a pixel", () => {
  const line = "[Parsed_bbox_1 @ 0x70cb9c004800] n:1 pts:1 pts_time:0.2 x1:478 x2:602 y1:1621 y2:1666 w:125 h:46 crop=125:46:478:1621 drawbox=478:1621:125:46"
  expect(inkOf(`noise\n${line}\n`)).toEqual([{ at: 0.2, rect: { left: 478, top: 1621, right: 603, bottom: 1667 } }])
})
