import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { BunFileSystem } from "@effect/platform-bun"
import { Deferred, Effect, Fiber, FileSystem, Logger, Schema } from "effect"
import { readTexts } from "../../src/server/captions.ts"
import { readFace, writeFace } from "../../src/server/face.ts"
import { looksView, readExample, readNoise, writeLooks, writeNoise } from "../../src/server/looks.ts"
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

const cases = [
  { name: "face then noise", first: (dir: string) => writeFace(dir, "light"), second: (dir: string) => writeNoise(dir, "light"), expected: { face: "light", noise: "light" } as const },
  { name: "noise then face", first: (dir: string) => writeNoise(dir, "light"), second: (dir: string) => writeFace(dir, "light"), expected: { face: "light", noise: "light" } as const },
  { name: "face then face", first: (dir: string) => writeFace(dir, "light"), second: (dir: string) => writeFace(dir, "off"), expected: { face: "off", noise: "strong" } as const },
  { name: "noise then noise", first: (dir: string) => writeNoise(dir, "light"), second: (dir: string) => writeNoise(dir, "off"), expected: { face: "off", noise: "off" } as const }
]

for (const scenario of cases) {
  test(`concurrent ${scenario.name} saves neither lose choices nor collide on the temporary file`, async () => {
    await mkdir("node_modules/.cache", { recursive: true })
    const dir = await mkdtemp("node_modules/.cache/looks-")
    try {
      await writeFile(`${dir}/looks.json`, JSON.stringify({ face: "off", noise: "strong" }))
      const result = await Effect.runPromise(Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const written = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        let reads = 0
        let writes = 0
        const controlled = FileSystem.FileSystem.of({
          ...fs,
          exists: () => Effect.succeed(true),
          readFileString: (path) => Effect.sync(() => {
            reads += 1
            return readFileSync(path, "utf8")
          }),
          writeFileString: (path, text, options) => Effect.gen(function*() {
            yield* fs.writeFileString(path, text, options)
            writes += 1
            if (writes === 1) {
              yield* Deferred.succeed(written, undefined)
              yield* Deferred.await(release)
            }
          })
        })
        const save = Effect.gen(function*() {
          const first = yield* Effect.forkChild(scenario.first(dir))
          yield* Deferred.await(written)
          const second = yield* Effect.forkChild(scenario.second(dir), { startImmediately: true })
          const readsWhileWriting = reads
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(first)
          yield* Fiber.join(second)
          return { readsWhileWriting, face: yield* readFace(dir), noise: yield* readNoise(dir) }
        })
        return yield* save.pipe(Effect.provideService(FileSystem.FileSystem, controlled))
      }).pipe(Effect.provide(BunFileSystem.layer)))
      expect(result.readsWhileWriting).toBe(1)
      expect({ face: result.face, noise: result.noise }).toEqual(scenario.expected)
      const persisted: unknown = JSON.parse(await readFile(`${dir}/looks.json`, "utf8"))
      expect(persisted).toMatchObject(scenario.expected)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
