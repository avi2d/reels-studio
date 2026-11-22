import { Context, DateTime, Effect, FileSystem, Layer, Option, Path, Ref, Schema } from "effect"
import { afterYes, Approval, MAX_BRIEF, planView, type BriefView, type PlanView } from "../shared/brief.ts"
import { gazePending, gatherStep } from "../shared/gather.ts"
import { NO_EDITS } from "../shared/timeline.ts"
import { GatherState } from "./gather-state.ts"
import { readGathered, readyTranscripts } from "./timeline-files.ts"
import { type ApiError, badRequest, orUnavailable } from "./api-error.ts"
import { Media } from "./media.ts"
import { Projects } from "./projects.ts"

const ApprovalFile = Schema.fromJsonString(Approval)
const decodeApproval = Schema.decodeUnknownOption(ApprovalFile)
const encodeApproval = Schema.encodeEffect(ApprovalFile)

const UNAVAILABLE = "Задание недоступно. Попробуйте открыть страницу ещё раз."
const orBroken = orUnavailable("the brief failed", UNAVAILABLE)

export class Brief extends Context.Service<Brief, {
  readonly view: (id: string) => Effect.Effect<BriefView, ApiError>
  readonly write: (id: string, text: string) => Effect.Effect<void, ApiError>
  readonly plan: (id: string) => Effect.Effect<PlanView, ApiError>
  readonly workAlone: (id: string, plan: string, replied: Effect.Effect<void>) => Effect.Effect<void, ApiError>
  readonly working: (id: string) => Effect.Effect<boolean>
  readonly agree: (id: string, plan: string) => Effect.Effect<void>
}>()("reels-studio/Brief") {
  static readonly layer = Layer.effect(
    Brief,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const projects = yield* Projects
      const media = yield* Media
      const state = yield* GatherState

      const readText = Effect.fnUntraced(function*(file: string) {
        if (!(yield* fs.exists(file))) return undefined
        return yield* fs.readFileString(file)
      })

      const replace = Effect.fnUntraced(function*(file: string, text: string) {
        yield* fs.writeFileString(`${file}.new`, text)
        yield* fs.rename(`${file}.new`, file)
      })

      const plan = Effect.fn("Brief.plan")(function*(id: string) {
        const dir = yield* projects.folder(id)
        const text = yield* readText(path.join(dir, "plan.md"))
        const saved = yield* readText(path.join(dir, "approval.json"))
        const approval = saved === undefined ? undefined : Option.getOrUndefined(decodeApproval(saved))
        return planView(text, approval)
      }, orBroken)

      const view = Effect.fn("Brief.view")(function*(id: string) {
        const dir = yield* projects.folder(id)
        const brief = (yield* readText(path.join(dir, "brief.md")).pipe(orBroken)) ?? ""
        const working = yield* state.working(id)
        return { brief, plan: yield* plan(id), working }
      })

      const write = Effect.fn("Brief.write")(function*(id: string, text: string) {
        const trimmed = text.trim()
        if (trimmed.length > MAX_BRIEF) return yield* badRequest(`Сократите задание до ${MAX_BRIEF} знаков`)
        const dir = yield* projects.folder(id)
        yield* replace(path.join(dir, "brief.md"), trimmed === "" ? "" : `${trimmed}\n`).pipe(orBroken)
      })

      const settleGathering = Effect.fnUntraced(function*(id: string, dir: string) {
        for (;;) {
          if (yield* state.running(id)) yield* state.settled(id)
          else {
            const videos = yield* media.videos(id)
            const timelineView = yield* media.timeline(id)
            const heard = videos.flatMap((video) => video.state === "ready" ? [video.name] : [])
            const listening = videos.some((video) => video.state === "waiting")
            const settled = timelineView.looks.flatMap((look) => look.state === "waiting" ? [] : [look.video])
            const gathered = yield* readGathered(dir).pipe(Effect.provideService(FileSystem.FileSystem, fs), orBroken)
            if (!listening && gatherStep(heard, settled, listening, gathered).kind === "wait" && !gazePending(heard, settled)) return
          }
          yield* Effect.sleep("1 second")
        }
      })

      const working = (id: string): Effect.Effect<boolean> => state.working(id)

      const agreed = yield* Ref.make<ReadonlyMap<string, string>>(new Map())
      const agree = (id: string, planText: string): Effect.Effect<void> =>
        Ref.update(agreed, (map) => {
          const next = new Map(map)
          next.set(id, planText)
          return next
        })

      const workAlone = Effect.fn("Brief.workAlone")(function*(id: string, approved: string, replied: Effect.Effect<void>) {
        return yield* state.trackAlone(id, Effect.gen(function*() {
          yield* replied
          const dir = yield* projects.folder(id)
          yield* settleGathering(id, dir)
          const { timeline } = yield* media.timeline(id)
          const transcripts = readyTranscripts(yield* media.videos(id))
          const done = timeline.state === "ready"
            ? yield* media.exchangeEdits(id, (current) => {
              const outcome = afterYes(timeline.blocks, current, transcripts)
              return { edits: outcome.edits, value: outcome.done }
            })
            : afterYes([], NO_EDITS, transcripts).done
          const latest = (yield* Ref.get(agreed)).get(id) ?? approved
          const at = DateTime.formatIso(yield* DateTime.now)
          const text = yield* encodeApproval({ plan: latest, at, done }).pipe(orBroken)
          yield* replace(path.join(dir, "approval.json"), text).pipe(orBroken)
        }).pipe(Effect.ensuring(Ref.update(agreed, (map) => {
          const next = new Map(map)
          next.delete(id)
          return next
        }))))
      })

      return Brief.of({ view, write, plan, workAlone, working, agree })
    })
  )
}
