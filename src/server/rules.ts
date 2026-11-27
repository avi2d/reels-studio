import { Effect, FileSystem, Option, Schema } from "effect"
import { formatSeconds, RuleChange, RulesFile, rulesOf, type RuleId } from "../shared/rules.ts"
import { libraryDir } from "./library.ts"

const RulesJson = Schema.fromJsonString(RulesFile)
const decodeRules = Schema.decodeUnknownOption(RulesJson)
const encodeRules = Schema.encodeEffect(RulesJson)
const ChangeJson = Schema.fromJsonString(RuleChange)
const decodeChange = Schema.decodeUnknownOption(ChangeJson)
const encodeChange = Schema.encodeEffect(ChangeJson)

const ownPath = (dir: string): string => `${dir}/rules.json`
const changePath = (dir: string): string => `${dir}/rules-change.json`
const keptPath = (projectsDir: string): string => `${libraryDir(projectsDir)}/rules.json`

export type OwnRules = RulesFile | "unreadable"

const readRulesAt = Effect.fnUntraced(function*(file: string) {
  const fs = yield* FileSystem.FileSystem
  if (!(yield* fs.exists(file))) return {} satisfies OwnRules
  const read = Option.getOrUndefined(decodeRules(yield* fs.readFileString(file)))
  if (read !== undefined) return read satisfies OwnRules
  yield* Effect.logError("the rules are unreadable", file)
  return "unreadable" satisfies OwnRules
})

const usable = (own: OwnRules): RulesFile => own === "unreadable" ? {} : own

const replace = Effect.fnUntraced(function*(file: string, text: string) {
  const fs = yield* FileSystem.FileSystem
  yield* fs.writeFileString(`${file}.new`, text)
  yield* fs.rename(`${file}.new`, file)
})

export const readOwnRules = Effect.fnUntraced(function*(dir: string) {
  return yield* readRulesAt(ownPath(dir))
})

export const reelRules = Effect.fnUntraced(function*(dir: string) {
  return rulesOf(usable(yield* readOwnRules(dir)))
})

export const readKeptRules = Effect.fnUntraced(function*(projectsDir: string) {
  return usable(yield* readRulesAt(keptPath(projectsDir)))
})

const writeOwnRules = Effect.fnUntraced(function*(dir: string, rules: RulesFile) {
  yield* replace(ownPath(dir), yield* encodeRules(rules))
})

const writeKeptRules = Effect.fnUntraced(function*(projectsDir: string, rules: RulesFile) {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(libraryDir(projectsDir), { recursive: true })
  yield* replace(keptPath(projectsDir), yield* encodeRules(rules))
})

export const readChange = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const file = changePath(dir)
  if (!(yield* fs.exists(file))) return undefined
  return Option.getOrUndefined(decodeChange(yield* fs.readFileString(file)))
})

// A pinned rule follows this reel's change and its undo, so the pin never shows off while the old value still starts the next reels.
const movePin = Effect.fnUntraced(function*(projectsDir: string, id: RuleId, from: number, to: number) {
  const kept = yield* readKeptRules(projectsDir)
  if (kept[id] === from) yield* writeKeptRules(projectsDir, { ...kept, [id]: to })
})

const noteChange = Effect.fnUntraced(function*(dir: string, projectsDir: string, before: OwnRules) {
  const from = rulesOf(usable(before)).pause
  const to = (yield* reelRules(dir)).pause
  if (from === to) return
  yield* replace(changePath(dir), yield* encodeChange({ id: "pause", from, to, before: usable(before) }))
  yield* movePin(projectsDir, "pause", from, to)
})

// Read before the reply, so a rule the model writes during it is told apart from the one the reel had.
export const watchRules = Effect.fnUntraced(function*(dir: string, projectsDir: string) {
  const before = yield* readOwnRules(dir)
  yield* Effect.addFinalizer(() => noteChange(dir, projectsDir, before).pipe(Effect.catch((error) => Effect.logError("the rule change was not saved", error))))
  return before
})

export const rulesLine = (own: OwnRules): string => own === "unreadable"
  ? "Studio note: rules.json is not valid and must be rewritten as «Rules» in the reels-plan skill says. Until then the studio keeps 0.2 s at each shortened pause."
  : `Studio note: a shortened pause keeps ${formatSeconds(rulesOf(own).pause)} s now${own.pause === undefined ? ", the studio default" : ""}. This value counts even when an earlier message names another, since the person can return a rule on the page.`

export const startRules = Effect.fnUntraced(function*(projectsDir: string, dir: string) {
  yield* writeOwnRules(dir, yield* readKeptRules(projectsDir))
})

export const undoChange = Effect.fnUntraced(function*(dir: string, projectsDir: string) {
  const fs = yield* FileSystem.FileSystem
  const change = yield* readChange(dir)
  if (change !== undefined) {
    yield* writeOwnRules(dir, change.before)
    yield* movePin(projectsDir, change.id, change.to, change.from)
  }
  yield* fs.remove(changePath(dir), { force: true })
})

// Unpinning writes the value into this reel first, so only the next reels lose it.
export const keepRule = Effect.fnUntraced(function*(dir: string, projectsDir: string, id: RuleId, kept: boolean) {
  const own = usable(yield* readOwnRules(dir))
  const value = rulesOf(own)[id]
  const { [id]: _dropped, ...others } = yield* readKeptRules(projectsDir)
  if (kept) return yield* writeKeptRules(projectsDir, { ...others, [id]: value })
  yield* writeOwnRules(dir, { ...own, [id]: value })
  yield* writeKeptRules(projectsDir, others)
})
