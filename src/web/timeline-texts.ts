import type { TextDrop, TextPlace } from "../shared/captions.ts"
import type { PlannedText, PlannedTexts } from "../shared/texts.ts"
import { h } from "./dom.ts"
import { formatLength } from "./format.ts"

export interface TextData {
  readonly planned: PlannedTexts
  readonly places: ReadonlyArray<TextPlace>
  readonly phraseOf: (planned: PlannedText) => string
}

const whyDropped = (reason: TextDrop, planned: PlannedText): string => {
  if (reason === "unknown-video") return `Видео «${planned.video}» нет в проекте, поэтому студия не знает, где показать мысль.`
  if (reason === "out-of-range") return `В тексте видео «${planned.video}» нет слов, к которым привязана мысль, поэтому студия не знает, где её показать.`
  if (reason === "cut") return "Этой фразы сейчас нет в ролике, поэтому мысль в ролик не встанет."
  if (reason === "empty") return "У мысли нет ни одной строки текста, поэтому показывать нечего."
  return "Предыдущая мысль займёт экран на всё время этой фразы, поэтому эта мысль в ролик не встанет."
}

const linesOf = (planned: PlannedText): string => {
  const text = planned.lines.map((line) => line.text.trim()).filter((line) => line !== "").join(" / ")
  return text === "" ? "Без текста" : `«${text}»`
}

const saidOf = (place: TextPlace, data: TextData): string | undefined => {
  if (place.state === "dropped" && (place.reason === "unknown-video" || place.reason === "out-of-range")) return undefined
  const phrase = `на словах «${data.phraseOf(place.planned)}»`
  return place.state === "shown" ? `${phrase} · ${formatLength(place.shown.start)}` : phrase
}

const textItem = (place: TextPlace, number: number, data: TextData): HTMLElement => {
  const said = saidOf(place, data)
  return h("li", { class: place.state === "shown" ? "pause-row place text-place answered" : "pause-row place text-place dropped", "data-key": `text:${place.planned.id}` },
    h("span", { class: "where" },
      h("b", {}, place.state === "shown" ? `Мысль ${number}` : `Мысль ${number} не встанет в ролик`),
      h("span", { class: "text-lines" }, linesOf(place.planned)),
      ...(said === undefined ? [] : [h("span", {}, said)]),
      ...(place.state === "dropped" ? [h("span", { class: "error" }, whyDropped(place.reason, place.planned))] : [])))
}

const statusOf = ({ planned, places }: TextData): ReadonlyArray<HTMLElement> => {
  if (planned.state === "unreadable") return [h("p", { class: "error", role: "status" }, "Ключевые мысли не прочитались, поэтому в ролике их нет. Попросите студию написать их заново.")]
  if (planned.state !== "ready") return []
  const dropped = places.filter((place) => place.state === "dropped").length
  const count = places.length === 0 ? "Ключевых мыслей нет." : dropped === 0 ? `Встанут в ролик: ${places.length}.` : `Не встанут в ролик: ${dropped} из ${places.length}.`
  return [h("p", { class: dropped === 0 ? "muted" : "error", role: "status" }, count)]
}

export const textList = (data: TextData): ReadonlyArray<HTMLElement> =>
  data.planned.state === "none" ? [] : [h("div", { class: "detail texts" },
    h("h3", {}, "Ключевые мысли"),
    h("p", { class: "did" }, "Пока звучит фраза, вверху кадра стоит её ключевая мысль. Две мысли не стоят на экране одновременно."),
    ...statusOf(data),
    h("ol", { class: "place-list" }, ...data.places.map((place, index) => textItem(place, index + 1, data))))]
