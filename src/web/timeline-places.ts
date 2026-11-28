import type { Join, Place } from "../shared/joins.ts"
import type { JoinAnswer } from "../shared/timeline.ts"

export interface PlaceActions {
  readonly hearJoin: (join: Join) => void
  readonly hearUnaligned: (join: Join) => void
  readonly answer: (join: Join, answer: JoinAnswer) => void
  readonly cover: (join: Join, picture: string) => void
  readonly pictureUrl: (picture: string) => string
}

export interface AnswerText {
  readonly label: string
  readonly does: string
  readonly done: string
}

const ANSWERS: ReadonlyArray<readonly [JoinAnswer, AnswerText]> = [
  ["zoom", {
    label: "Выровнять",
    does: "Студия чуть приближает картинку после склейки, чтобы глаза остались на той же высоте.",
    done: "картинка после склейки приближена"
  }],
  ["trim", {
    label: "Обрезать",
    does: "Студия убирает кадры с опущенным взглядом у склейки. Она режет только картинку над тишиной, а слова не трогает.",
    done: "опущенный взгляд обрезан"
  }],
  ["leave", { label: "Оставить как есть", does: "Склейка остаётся такой, как сейчас.", done: "склейка остаётся" }]
]

export const COVER = {
  label: "Закрыть картинкой",
  does: "Вашу картинку видно секунду до склейки и полторы после, а голос продолжается."
}

const seconds = (value: number): string => `${value.toFixed(1).replace(".", ",")} с`

const percent = (scale: number): string => `${Math.round((scale - 1) * 100)} %`

const doneText = ({ answer, trim, align }: Place, text: AnswerText): string => {
  if (answer === "trim") return `${text.done}: ${seconds(trim.cut)}`
  if (answer === "zoom" && align.kind === "zoom") return `${text.done} на ${percent(align.frame.scale)}`
  return text.done
}

export const doneOf = (place: Place): ReadonlyArray<string> => {
  const { answered } = place
  if (answered?.answer === "cover") return [`закрыта картинкой «${answered.picture}»`]
  return ANSWERS.flatMap(([one, text]) => one !== place.answer ? [] : [doneText(place, text)])
}

export const alignNote = ({ align, answer }: Place): string => {
  if (answer !== undefined) return ""
  if (align.kind === "zoom") return `глаза можно выровнять: картинка после склейки станет крупнее на ${percent(align.frame.scale)}`
  if (align.kind === "far") return "выровнять нельзя: сдвиг слишком большой, приближением его не скрыть"
  if (align.kind === "level") return "глаза уже на одной высоте, выравнивать нечего"
  return "студия ещё измеряет кадр, выровнять можно будет позже"
}

const bare = (word: string): string => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")

const wordNote = ({ trim }: Place): string | undefined =>
  trim.spoken === undefined ? undefined : `взгляд опущен и на слове «${bare(trim.spoken)}», а слова студия не режет`

export const trimNote = (place: Place): string => {
  const word = wordNote(place)
  if (place.answer !== undefined) return word ?? ""
  if (place.trim.cut === 0) return word === undefined ? "опущенного взгляда нет, обрезать нечего" : `${word}, поэтому обрезать нечего`
  const can = `опущенный взгляд можно обрезать: ${seconds(place.trim.cut)}`
  return word === undefined ? can : `${can}, но ${word}`
}

export const offered = (place: Place): ReadonlyArray<readonly [JoinAnswer, AnswerText]> =>
  ANSWERS.filter(([answer]) => answer === "leave" || (answer === "trim" ? place.trim.cut > 0 : place.align.kind === "zoom"))
