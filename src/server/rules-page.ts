import { Effect } from "effect"
import { rulesView } from "../shared/rules.ts"
import { orUnavailable } from "./api-error.ts"
import { Media } from "./media.ts"
import { Projects } from "./projects.ts"
import { readChange, readKeptRules, reelRules } from "./rules.ts"
import { Settings } from "./settings.ts"
import { readyTranscripts } from "./timeline-files.ts"

export const orRules = orUnavailable("the rules failed", "Правила недоступны. Попробуйте ещё раз.")

export const rulesPage = Effect.fnUntraced(function*(id: string) {
  const store = yield* Projects
  const media = yield* Media
  const settings = yield* Settings
  const dir = yield* store.folder(id)
  const saved = yield* Effect.all({ rules: reelRules(dir), kept: readKeptRules(settings.projectsDir), change: readChange(dir) }).pipe(orRules)
  const { timeline, zooms, faces } = yield* media.timeline(id)
  const planned = zooms.state === "ready" ? zooms.planned : []
  const cut = timeline.state === "ready" ? { blocks: timeline.blocks, edits: timeline.edits, transcripts: readyTranscripts(yield* media.videos(id)), zooms: planned, faces } : undefined
  return rulesView(saved.rules, saved.kept, saved.change, cut)
})
