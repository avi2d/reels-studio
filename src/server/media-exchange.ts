import { type Crypto, Context, Effect, type FileSystem, Ref, Semaphore } from "effect"
import type { ChildProcessSpawner } from "effect/process"
import { linesProblem } from "../shared/texts.ts"
import { mergeEdits as joinEdits, type Edits } from "../shared/timeline.ts"
import { type ApiError, badRequest, orUnavailable } from "./api-error.ts"
import type { Projects } from "./projects.ts"
import type { Settings } from "./settings.ts"
import { readEdits, writeEdits } from "./timeline-files.ts"
export type Needs = FileSystem.FileSystem | Crypto.Crypto | Settings | ChildProcessSpawner.ChildProcessSpawner
export const makeExchange = (
  projects: Projects["Service"],
  context: Context.Context<Needs>
): Effect.Effect<{
  readonly exchangeEdits: <A>(id: string, compute: (current: Edits) => { readonly edits: Edits; readonly value: A }) => Effect.Effect<A, ApiError>
  readonly mergeEdits: (id: string, base: Edits, local: Edits) => Effect.Effect<Edits, ApiError>
}> => Effect.gen(function*() {
  const creation = yield* Semaphore.make(1)
  const guards = yield* Ref.make<ReadonlyMap<string, Semaphore.Semaphore>>(new Map())
  const guardFor = (dir: string): Effect.Effect<Semaphore.Semaphore> =>
    Effect.flatMap(Ref.get(guards), (known) => {
      const found = known.get(dir)
      if (found !== undefined) return Effect.succeed(found)
      return creation.withPermits(1)(Effect.gen(function*() {
        const latest = yield* Ref.get(guards)
        const again = latest.get(dir)
        if (again !== undefined) return again
        const fresh = yield* Semaphore.make(1)
        const next = new Map(latest)
        next.set(dir, fresh)
        yield* Ref.set(guards, next)
        return fresh
      }))
    })
  const exclusive = <A, E, R>(dir: string, use: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.flatMap(guardFor(dir), (guard) => guard.withPermits(1)(use))
  const exchangeEdits = <A>(id: string, compute: (current: Edits) => { readonly edits: Edits; readonly value: A }): Effect.Effect<A, ApiError> =>
    Effect.gen(function*() {
      const dir = yield* projects.folder(id)
      return yield* exclusive(dir, Effect.gen(function*() {
        const parsed = compute(yield* readEdits(dir))
        yield* writeEdits(dir, parsed.edits)
        return parsed.value
      }))
    }).pipe(orUnavailable("the timeline was not saved", "Не получилось сохранить монтаж. Попробуйте ещё раз."), Effect.provideContext(context))
  const mergeEdits = (id: string, base: Edits, local: Edits): Effect.Effect<Edits, ApiError> =>
    (local.texts ?? []).some((one) => one.answer === "retyped" && linesProblem(one.lines) !== undefined)
      ? Effect.fail(badRequest("Надпись не помещается на экране. Сократите её и сохраните ещё раз."))
      : exchangeEdits(id, (current) => {
        const edits = joinEdits(base, local, current)
        return { edits, value: edits }
      })
  return { exchangeEdits, mergeEdits }
})
