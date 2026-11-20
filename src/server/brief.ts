import { Context, DateTime, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { afterYes, Approval, MAX_BRIEF, planView, type BriefView, type PlanView } from "../shared/brief.ts"
import type { Transcript } from "../shared/plan.ts"
import { NO_EDITS } from "../shared/timeline.ts"
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
  readonly workAlone: (id: string, plan: string) => Effect.Effect<void, ApiError>
}>()("reels-studio/Brief") {
  static readonly layer = Layer.effect(
    Brief,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const projects = yield* Projects
      const media = yield* Media

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
        return { brief, plan: yield* plan(id) }
      })

      const write = Effect.fn("Brief.write")(function*(id: string, text: string) {
        const trimmed = text.trim()
        if (trimmed.length > MAX_BRIEF) return yield* badRequest(`Сократите задание до ${MAX_BRIEF} знаков`)
        const dir = yield* projects.folder(id)
        yield* replace(path.join(dir, "brief.md"), trimmed === "" ? "" : `${trimmed}\n`).pipe(orBroken)
      })

      const workAlone = Effect.fn("Brief.workAlone")(function*(id: string, approved: string) {
        const dir = yield* projects.folder(id)
        const { timeline } = yield* media.timeline(id)
        const videos = yield* media.videos(id)
        const transcripts = new Map(videos.flatMap((video): ReadonlyArray<readonly [string, Transcript]> =>
          video.state === "ready" ? [[video.name, video.transcript]] : []))
        const outcome = timeline.state === "ready"
          ? afterYes(timeline.blocks, timeline.edits, transcripts)
          : afterYes([], NO_EDITS, transcripts)
        if (timeline.state === "ready") yield* media.saveEdits(id, outcome.edits)
        const at = DateTime.formatIso(yield* DateTime.now)
        const text = yield* encodeApproval({ plan: approved, at, done: outcome.done }).pipe(orBroken)
        yield* replace(path.join(dir, "approval.json"), text).pipe(orBroken)
      })

      return Brief.of({ view, write, plan, workAlone })
    })
  )
}
