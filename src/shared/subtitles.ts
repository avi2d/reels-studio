import type { Span, Transcript } from "./plan.ts"
import type { Block, WordCorrection } from "./timeline.ts"

export const correctedWord = (
  blocks: ReadonlyArray<Block>, transcripts: ReadonlyMap<string, Transcript>,
  corrections: ReadonlyArray<WordCorrection>, block: string, video: string, index: number
): string => {
  const words = transcripts.get(video)?.words ?? []
  const original = words[index]?.text ?? ""
  const direct = corrections.find((one) => one.block === block && one.video === video && one.index === index)
  if (direct !== undefined) return direct.text
  const takes = blocks.find((one) => one.id === block)?.takes ?? []
  const key = bareWord(original).toLocaleLowerCase()
  const uniqueInContainingTakes = (source: string, at: number): boolean => {
    const containing = takes.filter((one) => one.video === source && at >= one.from && at <= one.to)
    return containing.length > 0 && containing.every((take) =>
      (transcripts.get(source)?.words ?? []).slice(take.from, take.to + 1).filter((word) => bareWord(word.text).toLocaleLowerCase() === key).length === 1)
  }
  if (key === "" || !uniqueInContainingTakes(video, index)) return original
  const matches = corrections.filter((one) => {
    if (one.block !== block) return false
    const source = transcripts.get(one.video)?.words[one.index]?.text
    return source !== undefined && bareWord(source).toLocaleLowerCase() === key && uniqueInContainingTakes(one.video, one.index)
  })
  return matches.length === 1 ? matches[0]?.text ?? original : original
}


export interface ShownWord extends Span {
  readonly text: string
}

interface Placed extends Span {
  readonly video: string
}

const WORD_HOLD = 0.4

const EDGE_MARKS = /^[\s.,!?;:…«»"“”„()[\]—–-]+|[\s.,!?;:…«»"“”„()[\]—–-]+$/gu

export const bareWord = (text: string): string => text.replace(EDGE_MARKS, "")

// A word stays until the next word starts, at most WORD_HOLD past its own end, and never past the cut that ends its clip.
export const subtitleWords = <T extends Placed>(
  clips: ReadonlyArray<T>, transcripts: ReadonlyMap<string, Transcript>,
  textOf: (clip: T, index: number, text: string) => string
): ReadonlyArray<ShownWord> => {
  const shown: Array<ShownWord> = []
  let at = 0
  for (const clip of clips) {
    const words = (transcripts.get(clip.video)?.words ?? [])
      .map((word, index) => ({ ...word, text: bareWord(textOf(clip, index, word.text)) }))
      .filter((word) => word.end > clip.start && word.start < clip.end && word.text !== "")
    words.forEach((word, index) => {
      const next = words[index + 1]
      const from = Math.max(word.start, clip.start)
      const to = Math.min(clip.end, word.end + WORD_HOLD, next === undefined ? Infinity : Math.max(next.start, word.end))
      shown.push({ text: word.text, start: at + from - clip.start, end: at + to - clip.start })
    })
    at += clip.end - clip.start
  }
  return shown
}
