import { judgeSound, LOUDNESS_TARGET, type Jump, type Sound, type Verdict } from "../shared/reel.ts"
import { formatLength } from "./format.ts"

const lufs = (value: number): string => `${String(Math.round(value)).replace("-", "−")}\u00a0LUFS`

export const SOUND_LABEL = { good: "Звук хороший", check: "Звук можно публиковать, но есть замечания", bad: "Звук плохой" } as const
const ISSUE_NOTE = {
  uneven: "Громкость меняется: тихие и громкие места звучат по-разному.",
  "over-peak": "Пики выше −1,5 dBTP.",
  clipping: "Срывы: пики выше 0 dBTP, звук будет обрезаться."
} as const

const JUMP_LIST = 5

const spanOf = (jump: Jump): string => {
  const from = formatLength(jump.from)
  const to = formatLength(jump.to)
  return from === to ? from : `${from}–${to}`
}

const jumpLine = (jumps: ReadonlyArray<Jump>, uneven: boolean): string => {
  if (jumps.length === 0) return uneven ? ISSUE_NOTE.uneven : "Скачков громкости нет."
  const spans = jumps.slice(0, JUMP_LIST).map(spanOf)
  const rest = jumps.length - spans.length
  return `Скачки громкости: ${spans.join(", ")}${rest > 0 ? ` и ещё ${rest}` : ""}.`
}

const averageLine = (offTarget: boolean): string =>
  offTarget ? `Средняя громкость далеко от цели ${lufs(LOUDNESS_TARGET)}.` : `Средняя громкость хорошая: цель ${lufs(LOUDNESS_TARGET)}.`

const peakLine = (verdict: Verdict): string => {
  if (verdict.issues.includes("clipping")) return ISSUE_NOTE.clipping
  if (verdict.issues.includes("over-peak")) return ISSUE_NOTE["over-peak"]
  return "Срывов нет."
}

export interface VerdictWords {
  readonly level: Verdict["level"]
  readonly label: string
  readonly notes: ReadonlyArray<string>
}

export const verdictWords = (sound: Sound, jumps: ReadonlyArray<Jump>): VerdictWords => {
  const verdict = judgeSound(sound)
  return {
    level: verdict.level,
    label: SOUND_LABEL[verdict.level],
    notes: [jumpLine(jumps, verdict.issues.includes("uneven")), averageLine(verdict.issues.includes("off-target")), peakLine(verdict)]
  }
}
