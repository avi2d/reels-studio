import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { BunFileSystem } from "@effect/platform-bun"
import { Effect, Logger, Schema } from "effect"
import { readTexts } from "../../src/server/captions.ts"
import { looksView, readExample, writeLooks } from "../../src/server/looks.ts"
import { LooksView, type ExampleLook } from "../../src/shared/looks.ts"

const example: ExampleLook = {
  took: ["Заголовок по центру"],
  subtitles: { font: "sans", colour: "#ffffff", outline: null, box: "#e63b5b", capitals: true },
  title: "middle"
}

test("both looks reads and writes carry the example title through the wire schema instead of dropping its placement", async () => {
  await mkdir("node_modules/.cache", { recursive: true })
  const dir = await mkdtemp("node_modules/.cache/looks-title-")
  try {
    await writeFile(`${dir}/example.json`, JSON.stringify(example))
    const read = await Effect.runPromise(looksView(dir).pipe(Effect.provide(BunFileSystem.layer)))
    expect(Schema.decodeSync(LooksView)(read).example).toEqual(example)
    const written = await Effect.runPromise(writeLooks(dir, { subtitles: { style: "example", size: "normal" } }).pipe(Effect.provide(BunFileSystem.layer)))
    expect(Schema.decodeSync(LooksView)(written).example).toEqual(example)
    expect(written.subtitles.style).toBe("example")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("example and text readers log changed invalid content once and clear repaired or missing files instead of suppressing later failures", async () => {
  await mkdir("node_modules/.cache", { recursive: true })
  const dir = await mkdtemp("node_modules/.cache/looks-unreadable-")
  const messages: Array<unknown> = []
  const logger = Logger.make((options) => { messages.push(options.message) })
  const read = () => Effect.runPromise(Effect.all([readExample(dir), readTexts(dir)]).pipe(
    Effect.provide([BunFileSystem.layer, Logger.layer([logger])])
  ))
  const invalid = async (text: string): Promise<void> => {
    await writeFile(`${dir}/example.json`, text)
    await writeFile(`${dir}/texts.json`, text)
  }
  try {
    await invalid("{")
    expect(await read()).toEqual([undefined, { state: "unreadable" }])
    await read()
    expect(messages).toHaveLength(2)
    expect(messages).toContainEqual(["the look of the example is unreadable", `${dir}/example.json`])
    expect(messages).toContainEqual(["the on-screen texts are unreadable", `${dir}/texts.json`])
    await invalid("not json")
    await read()
    expect(messages).toHaveLength(4)
    await writeFile(`${dir}/example.json`, JSON.stringify(example))
    await writeFile(`${dir}/texts.json`, JSON.stringify({ texts: [] }))
    expect(await read()).toEqual([example, { state: "ready", planned: [] }])
    await invalid("not json")
    await read()
    expect(messages).toHaveLength(6)
    await rm(`${dir}/example.json`)
    await rm(`${dir}/texts.json`)
    expect(await read()).toEqual([undefined, { state: "none" }])
    await invalid("not json")
    await read()
    expect(messages).toHaveLength(8)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
