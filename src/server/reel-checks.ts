import { Effect, FileSystem } from "effect"
import { isOpen, type Cut as MontageCut } from "../shared/montage-cut.ts"
import { judgeSound, jumpsOf, type Levelling } from "../shared/reel.ts"
import { UNBUILT_LOUDNESS, type BuildChecks, type LoudnessCheck, type PlacesCheck, type TextsCheck } from "../shared/reel-checks.ts"
import { blockAt } from "../shared/text-names.ts"
import { firstTextOutside } from "./captions.ts"
import type { Cut } from "./timeline-files.ts"

const MEASURED_KEPT = 100
type TextInk = "inside" | { readonly id: string | undefined }
const measured = new Map<string, TextInk>()

const remember = (key: string, ink: TextInk): TextInk => {
  if (measured.size >= MEASURED_KEPT) measured.delete(measured.keys().next().value ?? "")
  measured.set(key, ink)
  return ink
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
  const fs = yield* FileSystem.FileSystem
  const ink = measured.get(key) ?? (yield* Effect.gen(function*() {
    const work = yield* fs.makeTempDirectory({ prefix: "reel-check-" })
    return yield* firstTextOutside(work, cut.captions, seconds).pipe(
      Effect.ensuring(fs.remove(work, { recursive: true }).pipe(Effect.catch((error) => Effect.logError("the text check files were not removed", error)))),
      Effect.map((outside) => remember(key, outside))
    )
  }).pipe(
    Effect.catch((error) => Effect.as(Effect.logError("the on-screen texts were not measured", error), "unmeasured" as const))
  ))
  return ink === "inside" || ink === "unmeasured"
    ? { id: "texts", state: ink } satisfies TextsCheck
    : { id: "texts", state: "outside", ...namedText(montage, ink.id) } satisfies TextsCheck
})

const placesCheck = (montage: MontageCut | undefined): PlacesCheck => {
  const open = (montage?.questions ?? []).filter(isOpen)
  const part = open[0]?.part
  return part === undefined ? { id: "places", open: open.length } : { id: "places", open: open.length, part }
}

export const loudnessPartOf = (levelling: Levelling, seconds: number, clips: Cut["clips"]): string | undefined => {
  const jump = jumpsOf(levelling.series.after, seconds)[0]
  return judgeSound(levelling.after).level === "bad" && jump !== undefined ? blockAt(clips, jump.from) : undefined
}

export const loudnessCheck = (levelling: Levelling | undefined, part: string | undefined): LoudnessCheck => {
  if (levelling === undefined) return UNBUILT_LOUDNESS
  const { level } = judgeSound(levelling.after)
  return part === undefined ? { id: "loudness", state: "heard", level } : { id: "loudness", state: "heard", level, part }
}

export const readChecks = Effect.fnUntraced(function*(dir: string, cut: Cut, montage: MontageCut | undefined, seconds: number) {
  return {
    texts: yield* textsCheck(dir, cut, montage, seconds),
    places: placesCheck(montage),
    length: { id: "length", seconds }
  } satisfies BuildChecks
})
