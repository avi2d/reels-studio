import { isCovered, type Covered } from "../../shared/face-cover.ts"
import type { Sheet } from "../../shared/reel.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { formatLength } from "../format.ts"
import { styleOf } from "../margins.ts"

const BANDS = ["top", "bottom", "left", "right", "buttons"] as const

const spanText = (span: Covered): string => {
  const from = formatLength(span.from)
  const to = formatLength(span.to)
  return from === to ? from : `${from}–${to}`
}

const coverSentence = (sheet: Sheet): string => {
  if (sheet.covered === undefined) return "Студия не нашла лицо в собранном ролике и не проверила, закрывают ли его кнопки Instagram."
  if (sheet.covered.length === 0) return "Кнопки Instagram нигде не закрывают лицо."
  return `Кнопки Instagram закрывают лицо: ${sheet.covered.map(spanText).join(", ")}.`
}

const frame = (projectId: string, made: string, sheet: Sheet, time: number, index: number): HTMLElement => {
  const covered = isCovered(sheet.covered ?? [], time)
  return h("figure", { class: `done-frame${covered ? " done-frame--covered" : ""}` },
    h("div", { class: "done-frame__picture" },
      h("img", { src: Api.reelFrameUrl(projectId, made, index), alt: `Кадр на ${formatLength(time)}`, loading: "lazy", decoding: "async" }),
      h("div", { class: "done-zones", "aria-hidden": "true", style: styleOf("Instagram") },
        ...BANDS.map((band) => h("div", { class: `done-zone done-zone--${band}` })))),
    h("figcaption", {}, covered ? `${formatLength(time)} · лицо под кнопками` : formatLength(time)))
}

export interface SheetView {
  readonly node: HTMLElement
  readonly paint: (made: string, sheet: Sheet | undefined) => void
}

export const sheetView = (projectId: string): SheetView => {
  const sentence = h("p", { class: "done-sheet__sentence" })
  const frames = h("div", { class: "done-sheet__frames" })
  const node = h("section", { class: "done-sheet", "aria-labelledby": "done-sheet-title", hidden: true },
    h("h2", { id: "done-sheet-title" }, "Кадры под кнопками Instagram"), sentence, frames)
  let painted = ""
  return {
    node,
    paint: (made, sheet) => {
      node.hidden = sheet === undefined
      if (sheet === undefined) return
      const key = `${made}:${JSON.stringify(sheet)}`
      if (key === painted) return
      painted = key
      sentence.textContent = coverSentence(sheet)
      sentence.classList.toggle("done-sheet__sentence--warn", (sheet.covered ?? []).length > 0)
      frames.replaceChildren(...sheet.frames.map((time, index) => frame(projectId, made, sheet, time, index)))
    }
  }
}
