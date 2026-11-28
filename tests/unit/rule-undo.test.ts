import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { readChange, readKeptRules, reelRules, undoChange, watchRules } from "../../src/server/rules.ts"
import { rulesView } from "../../src/shared/rules.ts"
import { undoLabel } from "../../src/web/studio/rules.ts"

test("one reply that changes the pause and the zoom rule gets one button that names both and returns both, instead of a button per rule that silently returns the other", async () => {
  const projects = await mkdtemp(join(tmpdir(), "rule-undo-"))
  const dir = join(projects, "reel")
  try {
    await mkdir(dir)
    await writeFile(join(dir, "rules.json"), JSON.stringify({ pause: 0.2, zoom: "full" }))
    const program = Effect.gen(function*() {
      yield* Effect.scoped(Effect.gen(function*() {
        yield* watchRules(dir, projects)
        yield* Effect.promise(() => writeFile(join(dir, "rules.json"), JSON.stringify({ pause: 0.3, zoom: "soft" })))
      }))
      const view = rulesView(yield* reelRules(dir), yield* readKeptRules(projects), yield* readChange(dir), undefined)
      expect(view.changes.map((change) => change.id)).toEqual(["pause", "zoom"])
      expect(undoLabel(view.changes)).toBe("Вернуть 0,2 с и сильные")
      yield* undoChange(dir, projects)
      expect(yield* reelRules(dir)).toEqual({ pause: 0.2, zoom: "full" })
      expect(rulesView(yield* reelRules(dir), yield* readKeptRules(projects), yield* readChange(dir), undefined).changes).toEqual([])
    }).pipe(Effect.provide(BunServices.layer))
    await Effect.runPromise(program)
  } finally {
    await rm(projects, { recursive: true, force: true })
  }
})
