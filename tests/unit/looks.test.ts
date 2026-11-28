import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { BunFileSystem } from "@effect/platform-bun"
import { Deferred, Effect, Fiber, FileSystem } from "effect"
import { readFace, readNoise, writeFace, writeNoise } from "../../src/server/face.ts"

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
      expect(persisted).toEqual(scenario.expected)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
