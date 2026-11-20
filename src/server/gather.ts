import { Context, Effect, Exit, FileSystem, Layer, Option, Path, Ref, Schema } from "effect"
import { shortenPlaced } from "../shared/brief.ts"
import { Gathered, gatherStep } from "../shared/gather.ts"
import { Chat } from "./chat.ts"
import { Media } from "./media.ts"
import { Projects } from "./projects.ts"
import { readyTranscripts } from "./timeline-files.ts"

const GatheredFile = Schema.fromJsonString(Gathered)
const decodeGathered = Schema.decodeUnknownOption(GatheredFile)
const encodeGathered = Schema.encodeEffect(GatheredFile)

export class Gather extends Context.Service<Gather, {
  readonly running: (id: string) => Effect.Effect<boolean>
  readonly failed: (id: string) => Effect.Effect<boolean>
}>()("reels-studio/Gather") {
  static readonly layer = Layer.effect(
    Gather,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const projects = yield* Projects
      const media = yield* Media
      const chat = yield* Chat
      const current = yield* Ref.make<string | undefined>(undefined)

      const readGathered = Effect.fnUntraced(function*(dir: string) {
        const file = path.join(dir, "gathered.json")
        if (!(yield* fs.exists(file))) return undefined
        return Option.getOrUndefined(decodeGathered(yield* fs.readFileString(file)))
      })

      const readBlocks = Effect.fnUntraced(function*(dir: string) {
        const file = path.join(dir, "blocks.json")
        if (!(yield* fs.exists(file))) return undefined
        return yield* fs.readFileString(file)
      })

      const remember = Effect.fnUntraced(function*(dir: string, videos: ReadonlyArray<string>, settled: ReadonlyArray<string>, failed: boolean) {
        const file = path.join(dir, "gathered.json")
        yield* fs.writeFileString(`${file}.new`, yield* encodeGathered({ videos, gazed: [...settled], failed }))
        yield* fs.rename(`${file}.new`, file)
      })

      const stepOf = Effect.fnUntraced(function*(id: string) {
        const dir = yield* projects.folder(id)
        const gathered = yield* readGathered(dir)
        const videos = yield* media.videos(id)
        const heard = videos.flatMap((video) => video.state === "ready" ? [video.name] : [])
        const listening = videos.some((video) => video.state === "waiting")
        const view = yield* media.timeline(id)
        const settled = view.looks.flatMap((look) => look.state === "waiting" ? [] : [look.video])
        return { dir, step: gatherStep(heard, settled, listening, gathered) }
      })

      const visit = Effect.fnUntraced(function*(id: string) {
        const { dir, step } = yield* stepOf(id)
        if (step.kind === "wait") return
        yield* Ref.set(current, id)
        yield* Effect.gen(function*() {
          const before = yield* readBlocks(dir)
          const outcome = yield* chat.gather(id)
          if (outcome !== "gathered") return
          const after = yield* readBlocks(dir)
          const fresh = yield* media.timeline(id)
          if (before === after || fresh.timeline.state !== "ready") {
            yield* remember(dir, step.videos, step.settled, true)
            return
          }
          const heardVideos = yield* media.videos(id)
          yield* media.saveEdits(id, shortenPlaced(fresh.timeline.blocks, fresh.timeline.edits, readyTranscripts(heardVideos)))
          yield* remember(dir, step.videos, step.settled, false)
        }).pipe(Effect.ensuring(Ref.set(current, undefined)))
      })

      const round = Effect.gen(function*() {
        const listed = yield* projects.list
        yield* Effect.forEach(listed, (project) => Effect.exit(visit(project.id)).pipe(
          Effect.tap((exit) => Exit.isFailure(exit) ? Effect.logError("the gathering failed", project.id, exit.cause) : Effect.void)
        ), { discard: true })
      })

      const guarded = Effect.exit(round).pipe(
        Effect.tap((exit) => Exit.isFailure(exit) ? Effect.logError("the gathering round failed", exit.cause) : Effect.void),
        Effect.andThen(Effect.sleep("3 seconds"))
      )
      yield* Effect.forkScoped(Effect.forever(guarded))

      const running = (id: string): Effect.Effect<boolean> => Effect.gen(function*() {
        if ((yield* Ref.get(current)) === id) return true
        const { step } = yield* stepOf(id).pipe(Effect.orElseSucceed(() => ({ step: { kind: "wait" } as const })))
        return step.kind !== "wait"
      })
      const failed = (id: string): Effect.Effect<boolean> => Effect.gen(function*() {
        const gathered = yield* readGathered(yield* projects.folder(id)).pipe(Effect.orElseSucceed(() => undefined))
        return gathered?.failed === true
      })
      return Gather.of({ running, failed })
    })
  )
}
