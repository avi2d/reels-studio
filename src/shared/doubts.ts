import type { Doubt } from "./doubts-file.ts"
import type { Transcript } from "./plan.ts"
import { bareWord } from "./subtitles.ts"

type Words = Transcript["words"]

const LOST = 0.2
const UNSURE_NUMBER = 0.6
const UNSURE_NAME = 0.5
const SENTENCE_END = /[.!?…]$/u

const sameText = (left: string, right: string): boolean => bareWord(left).toLocaleLowerCase() === bareWord(right).toLocaleLowerCase()

// A low score alone marks too many words the recognizer heard right, so above LOST only numbers and names count.
const isUnsure = (words: Words, index: number): boolean => {
  const word = words[index]
  const text = bareWord(word?.text ?? "")
  if (word?.sure === undefined || text === "") return false
  if (word.sure < LOST) return true
  if (/\d/u.test(text)) return word.sure < UNSURE_NUMBER
  const opensSentence = index === 0 || SENTENCE_END.test(words[index - 1]?.text ?? "")
  return !opensSentence && /^\p{Lu}/u.test(text) && word.sure < UNSURE_NAME
}

export const unsureIndexes = (transcript: Transcript): ReadonlyArray<number> =>
  transcript.words.flatMap((_, index) => isUnsure(transcript.words, index) ? [index] : [])

export const isValidDoubt = (words: Words, doubt: Doubt): boolean => {
  const word = words[doubt.index]
  return word !== undefined && isUnsure(words, doubt.index) && bareWord(doubt.fix) !== "" && !sameText(doubt.fix, word.text)
}

export interface WordDoubt {
  readonly index: number
  readonly fix: string | undefined
  readonly reason: string
}

export const doubtsOf = (transcript: Transcript, video: string, planned: ReadonlyArray<Doubt>): ReadonlyArray<WordDoubt> => {
  const proposed = planned.filter((one) => one.video === video && isValidDoubt(transcript.words, one))
  return unsureIndexes(transcript).map((index) => {
    const doubt = proposed.find((one) => one.index === index)
    return { index, fix: doubt === undefined ? undefined : bareWord(doubt.fix), reason: doubt?.reason ?? "" }
  })
}

export type DoubtAnswer = "fix" | "heard" | "typed"

export const doubtAnswer = (heard: string, fix: string | undefined, corrected: string | undefined): DoubtAnswer | undefined => {
  if (corrected === undefined) return undefined
  if (fix !== undefined && sameText(corrected, fix)) return "fix"
  return sameText(corrected, heard) ? "heard" : "typed"
}
