import { Schema } from "effect"

// Instagram takes a reel of up to three minutes.
export const LONGEST_REEL = 180

const Part = Schema.optionalKey(Schema.String)

export const TextsCheck = Schema.Union([
  Schema.Struct({ id: Schema.Literal("texts"), state: Schema.Literals(["inside", "unmeasured"]) }),
  Schema.Struct({ id: Schema.Literal("texts"), state: Schema.Literal("outside"), text: Schema.String, part: Part })
])
export type TextsCheck = typeof TextsCheck.Type

export const PlacesCheck = Schema.Struct({ id: Schema.Literal("places"), open: Schema.Int, part: Part })
export type PlacesCheck = typeof PlacesCheck.Type

const LengthCheck = Schema.Struct({ id: Schema.Literal("length"), seconds: Schema.Finite })

export const LoudnessCheck = Schema.Union([
  Schema.Struct({ id: Schema.Literal("loudness"), state: Schema.Literal("unbuilt") }),
  Schema.Struct({ id: Schema.Literal("loudness"), state: Schema.Literal("heard"), level: Schema.Literals(["good", "check", "bad"]), part: Part })
])
export type LoudnessCheck = typeof LoudnessCheck.Type

export const BuildChecks = Schema.Struct({ texts: TextsCheck, places: PlacesCheck, length: LengthCheck })
export type BuildChecks = typeof BuildChecks.Type

export const ReelChecks = Schema.Struct({ ...BuildChecks.fields, loudness: LoudnessCheck })
export type ReelChecks = typeof ReelChecks.Type

export const UNBUILT_LOUDNESS = { id: "loudness", state: "unbuilt" } satisfies LoudnessCheck
export const DOWNLOAD_CLOSED = "Скачать ролик можно, когда пройдены все проверки выше."

export type ReelCheck = ReelChecks[keyof ReelChecks]

export type Mark = "pass" | "fail" | "after-build"

export const markOf = (check: ReelCheck): Mark => {
  switch (check.id) {
    case "texts": return check.state === "inside" ? "pass" : "fail"
    case "places": return check.open === 0 ? "pass" : "fail"
    case "length": return check.seconds <= LONGEST_REEL ? "pass" : "fail"
    case "loudness": return check.state === "unbuilt" ? "after-build" : check.level === "bad" ? "fail" : "pass"
  }
}

export const checkList = (checks: ReelChecks): ReadonlyArray<ReelCheck> => [checks.texts, checks.places, checks.length, checks.loudness]

export const buildFailures = (checks: BuildChecks): ReadonlyArray<BuildChecks[keyof BuildChecks]> =>
  [checks.texts, checks.places, checks.length].filter((check) => markOf(check) === "fail")

export const blocksBuild = (checks: BuildChecks): boolean => buildFailures(checks).length > 0

export const opensDownload = (checks: ReelChecks | undefined): boolean =>
  checks !== undefined && !blocksBuild(checks) && markOf(checks.loudness) === "pass"

const clock = (seconds: number, round: (value: number) => number = Math.round): string => {
  const whole = round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

export const checkTitle = (check: ReelCheck): string => {
  switch (check.id) {
    case "texts": return "Надписи в полях Instagram"
    case "places": return "Вопросы в монтаже"
    case "length": return `Длина до ${clock(LONGEST_REEL)}`
    case "loudness": return "Громкость"
  }
}

export const checkSentence = (check: ReelCheck): string => {
  switch (check.id) {
    case "texts":
      if (check.state === "outside") return `Надпись «${check.text}» выходит за поля Instagram. Сократите её на шаге «Монтаж».`
      return check.state === "inside" ? "Все надписи внутри полей." : "Студия не смогла проверить надписи. Подробности в журнале студии. Откройте шаг заново."
    case "places":
      return check.open === 0 ? "Вопросов не осталось." : `В монтаже остались вопросы: ${check.open}. Ответьте на них на шаге «Монтаж».`
    case "length":
      return check.seconds <= LONGEST_REEL
        ? `Ролик идёт ${clock(check.seconds)}.`
        : `Ролик идёт ${clock(check.seconds, Math.ceil)}, а Instagram берёт до ${clock(LONGEST_REEL)}. Уберите из монтажа ${clock(check.seconds - LONGEST_REEL, Math.ceil)}.`
    case "loudness":
      if (check.state === "unbuilt") return "Громкость студия проверит после сборки."
      if (check.level === "bad") return "Громкость далеко от нормы Instagram. Послушайте эту часть на шаге «Монтаж»."
      return check.level === "good" ? "Громкость в норме." : "Громкость близко к норме."
  }
}

export const placeOf = (check: ReelCheck): string | undefined => "part" in check ? check.part : undefined
