import { Schema } from "effect"

const edges = { left: Schema.Finite, top: Schema.Finite, right: Schema.Finite, bottom: Schema.Finite }

export const PageChars = Schema.Struct({
  width: Schema.Finite,
  height: Schema.Finite,
  chars: Schema.Array(Schema.Struct({ text: Schema.String, ...edges }))
})
export type PageChars = typeof PageChars.Type

const Box = Schema.Struct(edges)
type Box = typeof Box.Type

export interface Mark {
  readonly lines: ReadonlyArray<Box>
  readonly window: Box
}

const SPACE = /\s/u
const LINE_BREAK = /[\n\r]/u
const HYPHENS = new Set(["-", "\u2010", "\u2011", "\u00ad", String.fromCodePoint(2)])

interface Folded {
  readonly text: string
  readonly origin: ReadonlyArray<number>
}

// Hyphens are dropped from both the page and the quote, so a word the page breaks at a line end still matches the whole word.
const fold = (pieces: ReadonlyArray<string>): Folded => {
  const units: Array<string> = []
  const origin: Array<number> = []
  const state = { afterHyphen: false, joining: false }
  pieces.forEach((piece, index) => {
    for (const char of piece) {
      if (HYPHENS.has(char)) {
        state.afterHyphen = true
        continue
      }
      if (SPACE.test(char)) {
        state.joining ||= state.afterHyphen && LINE_BREAK.test(char)
        state.afterHyphen = false
        if (state.joining || units.length === 0 || units.at(-1) === " ") continue
        units.push(" ")
        origin.push(index)
        continue
      }
      state.afterHyphen = false
      state.joining = false
      for (const unit of char.toLowerCase().replace("ё", "е")) {
        units.push(unit)
        origin.push(index)
      }
    }
  })
  while (units.at(-1) === " ") {
    units.pop()
    origin.pop()
  }
  return { text: units.join(""), origin }
}

const quoteOf = (quote: string): string => fold([quote]).text

export const quoteFound = (pageText: string, quote: string): boolean => {
  const wanted = quoteOf(quote)
  return wanted !== "" && fold([pageText]).text.includes(wanted)
}

export const pageTextOf = (pagesText: string, page: number): string | undefined => {
  const head = `Page ${page}:\n`
  const later = pagesText.indexOf(`\n\n${head}`)
  const from = pagesText.startsWith(head) ? head.length : later < 0 ? -1 : later + 2 + head.length
  if (from < 0) return undefined
  const next = pagesText.indexOf(`\n\nPage ${page + 1}:\n`, from)
  return pagesText.slice(from, next < 0 ? undefined : next)
}

const LINE_PAD = 0.25
const WINDOW_MARGIN = 0.06
const NARROWEST_WINDOW = 0.6

const even = (value: number): number => 2 * Math.round(value / 2)

const linesOf = (boxes: ReadonlyArray<Box>): ReadonlyArray<Box> => {
  const lines: Array<Box> = []
  for (const box of boxes.toSorted((left, right) => left.top - right.top || left.left - right.left)) {
    const middle = (box.top + box.bottom) / 2
    const at = lines.findIndex((line) => middle >= line.top && middle <= line.bottom)
    const line = lines[at]
    if (line === undefined) lines.push(box)
    else lines[at] = { left: Math.min(line.left, box.left), top: Math.min(line.top, box.top), right: Math.max(line.right, box.right), bottom: Math.max(line.bottom, box.bottom) }
  }
  return lines
}

const padded = (line: Box, page: PageChars): Box => {
  const pad = (line.bottom - line.top) * LINE_PAD
  return {
    left: Math.max(0, even(line.left - pad)),
    top: Math.max(0, even(line.top - pad)),
    right: Math.min(page.width, even(line.right + pad)),
    bottom: Math.min(page.height, even(line.bottom + pad))
  }
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

// As wide as the text of the page, so no line is cut at the edge, and at most square, so the page stands as a card.
// It is no taller than the text, so a short page does not stand as a card of empty paper.
const windowOf = (lines: ReadonlyArray<Box>, page: PageChars): Box => {
  const letters = [...lines, ...page.chars.filter((char) => char.right > char.left && char.text.trim() !== "")]
  const margin = WINDOW_MARGIN * page.width
  const text = {
    left: Math.min(...letters.map((box) => box.left)),
    top: Math.max(0, Math.min(...letters.map((box) => box.top)) - margin),
    right: Math.max(...letters.map((box) => box.right)),
    bottom: Math.min(page.height, Math.max(...letters.map((box) => box.bottom)) + margin)
  }
  const top = Math.min(...lines.map((line) => line.top))
  const bottom = Math.max(...lines.map((line) => line.bottom))
  const width = even(Math.min(page.width, Math.max(text.right - text.left + 2 * margin, NARROWEST_WINDOW * page.width)))
  const height = even(Math.min(page.height, width, Math.max(text.bottom - text.top, bottom - top)))
  const x = even(clamp((text.left + text.right - width) / 2, 0, page.width - width))
  const y = even(clamp(clamp((top + bottom - height) / 2, text.top, text.bottom - height), 0, page.height - height))
  return { left: x, top: y, right: x + width, bottom: y + height }
}

export const markOf = (page: PageChars, quote: string): Mark | undefined => {
  const wanted = quoteOf(quote)
  const whole = fold(page.chars.map((char) => char.text))
  const at = wanted === "" ? -1 : whole.text.indexOf(wanted)
  if (at < 0) return undefined
  const boxes = [...new Set(whole.origin.slice(at, at + wanted.length))].flatMap((index) => {
    const char = page.chars[index]
    return char === undefined || char.right <= char.left || char.bottom <= char.top || char.text.trim() === "" ? [] : [char]
  })
  if (boxes.length === 0) return undefined
  const lines = linesOf(boxes).map((line) => padded(line, page))
  return { lines, window: windowOf(lines, page) }
}

const MARKER = "0xFFE066"

// The marker is multiplied into the page, so the quoted letters stay black under it, as under a highlighter pen.
export const markArgs = (picture: string, mark: Mark, output: string): ReadonlyArray<string> => {
  const boxes = mark.lines.map((line) => `drawbox=x=${line.left}:y=${line.top}:w=${line.right - line.left}:h=${line.bottom - line.top}:color=${MARKER}:t=fill`)
  const { window } = mark
  const crop = `crop=${window.right - window.left}:${window.bottom - window.top}:${window.left}:${window.top}`
  const paper = ["drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill", ...boxes].join(",")
  const graph = `[0:v]format=gbrp,split[page][ink];[ink]${paper}[marker];[page][marker]blend=all_mode=multiply,${crop},format=yuvj444p`
  return ["-hide_banner", "-loglevel", "error", "-y", "-i", picture, "-filter_complex", graph, "-frames:v", "1", "-q:v", "2", output]
}
