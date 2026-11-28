import { Effect, FileSystem } from "effect"
import { isOpen, type Cut as MontageCut } from "../shared/montage-cut.ts"
import { judgeSound, jumpsOf, type Levelling } from "../shared/reel.ts"
import type { LoudnessCheck, PlacesCheck, ReelChecks, TextsCheck } from "../shared/reel-checks.ts"
import { blockAt } from "../shared/text-names.ts"
import { firstTextOutside } from "./captions.ts"
import type { Cut } from "./timeline-files.ts"

const MEASURED_KEPT = 100
const measured = new Map<string, TextsCheck>()

const remember = (key: string, check: TextsCheck): TextsCheck => {
  if (measured.size >= MEASURED_KEPT) measured.delete(measured.keys().next().value ?? "")
  measured.set(key, check)
  return check
}

const namedText = (montage: MontageCut | undefined, id: string | undefined): { readonly text: string; readonly part?: string } => {
  const named = [...(montage?.parts.flatMap((part) => part.texts) ?? []), ...(montage?.outside.texts ?? [])]
    .find((one) => one.place.planned.id === id)
  if (named === undefined) return { text: "Надпись" }
  return named.part === undefined ? { text: named.name } : { text: named.name, part: named.part }
}

const textsCheck = Effect.fnUntraced(function*(dir: string, cut: Cut, montage: MontageCut | undefined, seconds: number) {
  if (cut.captions.texts.length === 0) return { id: "texts", state: "inside" } satisfies TextsCheck
  const key = `${dir}:${seconds}:${Bun.hash(JSON.stringify([cut.captions.texts, cut.captions.look, cut.captions.title]))}`
  const known = measured.get(key)
  if (known !== undefined) return known
  const fs = yield* FileSystem.FileSystem
  const found = yield* Effect.gen(function*() {
    const work = yield* fs.makeTempDirectory({ prefix: "reel-check-" })
    return yield* firstTextOutside(work, cut.captions, seconds).pipe(
      Effect.ensuring(fs.remove(work, { recursive: true }).pipe(Effect.catch((error) => Effect.logError("the text check files were not removed", error)))),
      Effect.map((outside): TextsCheck => outside === "inside" ? { id: "texts", state: "inside" } : { id: "texts", state: "outside", ...namedText(montage, outside.id) })
    )
  }).pipe(
    Effect.catch((error) => Effect.as(Effect.logError("the on-screen texts were not measured", error), { id: "texts", state: "unmeasured" } satisfies TextsCheck))
  )
  return found.state === "unmeasured" ? found : remember(key, found)
})

const placesCheck = (montage: MontageCut | undefined): PlacesCheck => {
  const open = (montage?.questions ?? []).filter(isOpen)
  const part = open[0]?.part
  return part === undefined ? { id: "places", open: open.length } : { id: "places", open: open.length, part }
}

const loudnessCheck = (levelling: Levelling | undefined, seconds: number, cut: Cut): LoudnessCheck => {
  if (levelling === undefined) return { id: "loudness", state: "unbuilt" }
  const { level } = judgeSound(levelling.after)
  const jump = jumpsOf(levelling.series.after, seconds)[0]
  const part = level === "bad" && jump !== undefined ? blockAt(cut.clips, jump.from) : undefined
  return part === undefined ? { id: "loudness", state: "heard", level } : { id: "loudness", state: "heard", level, part }
}

export interface Built {
  readonly seconds: number
  readonly levelling: Levelling | undefined
}

export const readChecks = Effect.fnUntraced(function*(dir: string, cut: Cut, montage: MontageCut | undefined, seconds: number, built: Built | undefined) {
  return {
    texts: yield* textsCheck(dir, cut, montage, seconds),
    places: placesCheck(montage),
    length: { id: "length", seconds },
    loudness: built === undefined ? { id: "loudness", state: "unbuilt" } : loudnessCheck(built.levelling, built.seconds, cut)
  } satisfies ReelChecks
})
