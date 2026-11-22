import type { Span, Transcript } from "./plan.ts"

export interface ShownWord extends Span {
  readonly text: string
}

interface Placed extends Span {
  readonly video: string
}

export const WORD_HOLD = 0.4

const EDGE_MARKS = /^[\s.,!?;:…«»"“”„()[\]—–-]+|[\s.,!?;:…«»"“”„()[\]—–-]+$/gu

export const bareWord = (text: string): string => text.replace(EDGE_MARKS, "")

// A word stays until the next word starts, at most WORD_HOLD past its own end, and never past the cut that ends its clip.
export const subtitleWords = (clips: ReadonlyArray<Placed>, transcripts: ReadonlyMap<string, Transcript>): ReadonlyArray<ShownWord> => {
  const shown: Array<ShownWord> = []
  let at = 0
  for (const clip of clips) {
    const words = (transcripts.get(clip.video)?.words ?? [])
      .filter((word) => word.end > clip.start && word.start < clip.end && bareWord(word.text) !== "")
    words.forEach((word, index) => {
      const next = words[index + 1]
      const from = Math.max(word.start, clip.start)
      const to = Math.min(clip.end, word.end + WORD_HOLD, next === undefined ? Infinity : Math.max(next.start, word.end))
      shown.push({ text: bareWord(word.text), start: at + from - clip.start, end: at + to - clip.start })
    })
    at += clip.end - clip.start
  }
  return shown
}
