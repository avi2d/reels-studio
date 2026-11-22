import { Effect, FileSystem, Option, Schema } from "effect"
import { Approval, planView } from "../shared/brief.ts"

const decodeApproval = Schema.decodeUnknownOption(Schema.fromJsonString(Approval))

export const readText = Effect.fnUntraced(function*(file: string) {
  const fs = yield* FileSystem.FileSystem
  if (!(yield* fs.exists(file))) return undefined
  return yield* fs.readFileString(file)
})

export const readApproval = Effect.fnUntraced(function*(dir: string) {
  const text = yield* readText(`${dir}/plan.md`)
  const texts = yield* readText(`${dir}/texts.json`)
  const saved = yield* readText(`${dir}/approval.json`)
  const approval = saved === undefined ? undefined : Option.getOrUndefined(decodeApproval(saved))
  return { plan: planView(text, texts, approval), texts }
})
