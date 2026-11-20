import { Context, Effect, Exit, FileSystem, Layer, Option, Path, Ref, Schema } from "effect"
import { afterYes } from "../shared/brief.ts"
import { Gathered, gatherStep } from "../shared/gather.ts"
import type { Transcript } from "../shared/plan.ts"
import { Chat } from "./chat.ts"
import { Media } from "./media.ts"
import { Projects } from "./projects.ts"

const GatheredFile = Schema.fromJsonString(Gathered)
const decodeGathered = Schema.decodeUnknownOption(GatheredFile)
const encodeGathered = Schema.encodeEffect(GatheredFile)

export class Gather extends Context.Service<Gather, {
  readonly running: (id: string) => Effect.Effect<boolean>
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

      const transcribed = Effect.fnUntraced(function*(dir: string) {
        const folder = path.join(dir, "transcripts")
        if (!(yield* fs.exists(folder))) return []
        const files = yield* fs.readDirectory(folder)
        return files.flatMap((file) => file.endsWith(".json") ? [file.slice(0, -".json".length)] : [])
      })

      const remember = Effect.fnUntraced(function*(dir: string, videos: ReadonlyArray<string>) {
        const file = path.join(dir, "gathered.json")
        yield* fs.writeFileString(`${file}.new`, yield* encodeGathered({ videos }))
        yield* fs.rename(`${file}.new`, file)
      })

      const chooseAndShorten = Effect.fnUntraced(function*(id: string) {
        const { timeline } = yield* media.timeline(id)
        if (timeline.state !== "ready") return
        const videos = yield* media.videos(id)
        const transcripts = new Map(videos.flatMap((video): ReadonlyArray<readonly [string, Transcript]> =>
          video.state === "ready" ? [[video.name, video.transcript]] : []))
        yield* media.saveEdits(id, afterYes(timeline.blocks, timeline.edits, transcripts).edits)
      })

      const visit = Effect.fnUntraced(function*(id: string) {
        const dir = yield* projects.folder(id)
        const file = path.join(dir, "gathered.json")
        const gathered = (yield* fs.exists(file)) ? Option.getOrUndefined(decodeGathered(yield* fs.readFileString(file))) : undefined
        const hasBlocks = yield* fs.exists(path.join(dir, "blocks.json"))
        if (gatherStep(yield* transcribed(dir), false, gathered, hasBlocks).kind === "wait") return
        const videos = yield* media.videos(id)
        const heard = videos.flatMap((video) => video.state === "ready" ? [video.name] : [])
        const step = gatherStep(heard, videos.some((video) => video.state === "waiting"), gathered, hasBlocks)
        if (step.kind === "wait") return
        if (step.kind === "seed") return yield* remember(dir, step.videos)
        yield* Ref.set(current, id)
        const outcome = yield* chat.gather(id).pipe(Effect.ensuring(Ref.set(current, undefined)))
        if (outcome !== "gathered") return
        yield* chooseAndShorten(id)
        yield* remember(dir, step.videos)
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

      const running = (id: string): Effect.Effect<boolean> => Ref.get(current).pipe(Effect.map((held) => held === id))
      return Gather.of({ running })
    })
  )
}
