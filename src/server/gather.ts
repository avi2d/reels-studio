import { Context, Effect, Exit, FileSystem, Layer, Path, Schema } from "effect"
import { shortenPlaced } from "../shared/brief.ts"
import { blocksHash, failedShows, Gathered, gatherStep, shortenDue } from "../shared/gather.ts"
import { Chat } from "./chat.ts"
import { GatherState } from "./gather-state.ts"
import { Media } from "./media.ts"
import { Projects } from "./projects.ts"
import { readGathered, readyTranscripts } from "./timeline-files.ts"

const encodeGathered = Schema.encodeEffect(Schema.fromJsonString(Gathered))

export class Gather extends Context.Service<Gather, {
  readonly running: (id: string) => Effect.Effect<boolean>
  readonly failed: (id: string) => Effect.Effect<boolean>
  readonly withoutGather: <A, E, R>(id: string, use: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}>()("reels-studio/Gather") {
  static readonly layer = Layer.effect(
    Gather,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const projects = yield* Projects
      const media = yield* Media
      const chat = yield* Chat
      const state = yield* GatherState

      const readBlocks = Effect.fnUntraced(function*(dir: string) {
        const file = path.join(dir, "blocks.json")
        if (!(yield* fs.exists(file))) return undefined
        return yield* fs.readFileString(file)
      })

      const remember = Effect.fnUntraced(function*(dir: string, videos: ReadonlyArray<string>, settled: ReadonlyArray<string>, failed: boolean, hash: string | undefined, shortened: string | undefined) {
        const file = path.join(dir, "gathered.json")
        yield* fs.writeFileString(`${file}.new`, yield* encodeGathered({ videos, gazed: [...settled], failed, ...(hash === undefined ? {} : { hash }), ...(shortened === undefined ? {} : { shortened }) }))
        yield* fs.rename(`${file}.new`, file)
      })

      const stepOf = Effect.fnUntraced(function*(id: string) {
        const dir = yield* projects.folder(id)
        const gathered = yield* readGathered(dir).pipe(Effect.provideService(FileSystem.FileSystem, fs))
        const videos = yield* media.videos(id)
        const heard = videos.flatMap((video) => video.state === "ready" ? [video.name] : [])
        const listening = videos.some((video) => video.state === "waiting")
        const view = yield* media.timeline(id)
        const settled = view.looks.flatMap((look) => look.state === "waiting" ? [] : [look.video])
        return { dir, step: gatherStep(heard, settled, listening, gathered), heard, listening, gathered }
      })

      const shortenChanged = Effect.fnUntraced(function*(id: string, dir: string, heard: ReadonlyArray<string>, listening: boolean, gathered: Gathered | undefined) {
        if (listening || heard.length === 0) return
        const after = yield* readBlocks(dir)
        if (!shortenDue(after, gathered?.shortened)) return
        const fresh = yield* media.timeline(id)
        const timeline = fresh.timeline
        if (timeline.state !== "ready") return
        const videos = yield* media.videos(id)
        yield* media.exchangeEdits(id, (current) => ({
          edits: shortenPlaced(timeline.blocks, current, readyTranscripts(videos)),
          value: undefined
        }))
        yield* remember(dir, gathered?.videos ?? heard, [...(gathered?.gazed ?? [])], gathered?.failed ?? false, gathered?.hash, blocksHash(after))
      })

      const visit = Effect.fnUntraced(function*(id: string) {
        const { dir, step, heard, listening, gathered } = yield* stepOf(id)
        if (yield* state.blocked(id)) return
        if (step.kind === "wait") {
          yield* shortenChanged(id, dir, heard, listening, gathered)
          return
        }
        yield* state.track(id, Effect.gen(function*() {
          const exit = yield* Effect.exit(chat.gather(id))
          const after = yield* readBlocks(dir)
          const fresh = yield* media.timeline(id)
          const timeline = fresh.timeline
          if (Exit.isFailure(exit) || timeline.state !== "ready") {
            yield* remember(dir, step.videos, step.settled, true, blocksHash(after), gathered?.shortened)
            return
          }
          const heardVideos = yield* media.videos(id)
          yield* media.exchangeEdits(id, (current) => ({
            edits: shortenPlaced(timeline.blocks, current, readyTranscripts(heardVideos)),
            value: undefined
          }))
          yield* remember(dir, step.videos, step.settled, false, undefined, blocksHash(after))
        }))
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
        if (yield* state.running(id)) return true
        return yield* Effect.gen(function*() {
          const { dir, step, heard, listening, gathered } = yield* stepOf(id)
          if (step.kind !== "wait") return true
          if (listening || heard.length === 0) return false
          return shortenDue(yield* readBlocks(dir), gathered?.shortened)
        }).pipe(Effect.orElseSucceed(() => false))
      })
      const failed = (id: string): Effect.Effect<boolean> => Effect.gen(function*() {
        const dir = yield* projects.folder(id).pipe(Effect.orElseSucceed(() => undefined))
        if (dir === undefined) return false
        const gathered = yield* readGathered(dir).pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.orElseSucceed(() => undefined))
        const blocks = yield* readBlocks(dir).pipe(Effect.orElseSucceed(() => undefined))
        return failedShows(gathered, blocks)
      })
      const withoutGather = <A, E, R>(id: string, use: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        state.withoutGather(id, use)
      return Gather.of({ running, failed, withoutGather })
    })
  )
}
