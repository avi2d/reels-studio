import { linesOfPlace } from "../../shared/captions.ts"
import type { Span } from "../../shared/plan.ts"
import { lineLength, lineLimit, linesProblem, type TextAnswer, type TextLine } from "../../shared/texts.ts"
import type { PageSource } from "../../shared/web-pages.ts"
import { h } from "../dom.ts"
import { formatLength } from "../format.ts"
import { whyDropped, type DroppedText } from "../text-drops.ts"
import type { NamedText } from "../../shared/text-names.ts"
import { articleWarnings } from "./page-source.ts"
import { button, card, choice } from "./ui.ts"

export interface TextActions {
  readonly showText: (span: Span) => void
  readonly answerText: (answer: TextAnswer) => void
}

const DONE = { keep: "оставлено", remove: "убрано", retyped: "исправлено" } satisfies Record<TextAnswer["answer"], string>

const signs = (count: number): string => {
  const tens = count % 100
  const ones = count % 10
  if (tens >= 11 && tens <= 14) return `${count} знаков`
  if (ones === 1) return `${count} знак`
  return ones >= 2 && ones <= 4 ? `${count} знака` : `${count} знаков`
}

const linesView = (lines: ReadonlyArray<TextLine>, off: boolean): HTMLElement =>
  h("span", { class: off ? "thought__lines thought__lines--off" : "thought__lines" }, ...lines.flatMap((line, index) =>
    [...index === 0 ? [] : [h("br")], line.accent ? h("mark", {}, line.text) : line.text]))

const overNote = (line: TextLine, index: number): string => {
  const over = lineLength(line) - lineLimit(line)
  return over <= 0 ? "" : `Строка ${index + 1} длиннее на ${signs(over)}: на экране помещается ${signs(lineLimit(line))}.`
}

const editor = (name: string, id: string, lines: ReadonlyArray<TextLine>, save: (lines: ReadonlyArray<TextLine>) => void, close: () => void): HTMLElement => {
  const fields = lines.map((line, index) => h("input", {
    class: "text-edit__field", value: line.text, "aria-label": `${name}, строка ${index + 1}${line.accent ? ", выделенная" : ""}`,
    "data-key": `text-line:${id}:${index}`, autocomplete: "off", spellcheck: "true"
  }))
  const counters = lines.map(() => h("span", { class: "text-edit__count", "aria-hidden": "true" }))
  const note = h("p", { class: "text-edit__note", role: "status" })
  let done = false
  const keep = button("main", "Сохранить", { "data-key": `save-text:${id}`, click: () => { finish(true) } })
  const typed = (): ReadonlyArray<TextLine> => lines.map((line, index) => ({ text: fields[index]?.value.trim() ?? "", accent: line.accent }))
  const check = (): void => {
    const now = typed()
    now.forEach((line, index) => {
      const counter = counters[index]
      if (counter === undefined) return
      counter.textContent = `${lineLength(line)}/${lineLimit(line)}`
      counter.classList.toggle("text-edit__count--over", lineLength(line) > lineLimit(line))
      fields[index]?.setAttribute("aria-invalid", String(lineLength(line) > lineLimit(line)))
    })
    const problem = linesProblem(now)
    note.textContent = problem === "empty" ? "Напишите хотя бы одну строку." : now.map(overNote).filter((one) => one !== "").join(" ")
    keep.disabled = problem !== undefined
  }
  const changed = (): boolean => typed().some((line, index) => line.text !== lines[index]?.text.trim())
  function finish(saved: boolean): void {
    if (done || (saved && linesProblem(typed()) !== undefined)) return
    done = true
    close()
    if (saved) save(typed())
  }
  const acts = h("div", { class: "ask__acts" }, keep, button("quiet", "Отмена", { "data-key": `cancel-text:${id}`, click: () => { finish(false) } }))
  // Safari does not focus a pressed button, so the press would move focus out of the form and close it before the click lands.
  acts.addEventListener("mousedown", (event) => { event.preventDefault() })
  const form = h("div", { class: "text-edit" },
    ...lines.map((line, index) => h("label", { class: line.accent ? "text-edit__line text-edit__line--accent" : "text-edit__line" },
      fields[index] ?? "", counters[index] ?? "")),
    note,
    acts)
  form.addEventListener("input", check)
  for (const field of fields) {
    field.addEventListener("keydown", (event) => {
      if (event.isComposing || (event.key !== "Enter" && event.key !== "Escape")) return
      event.preventDefault()
      finish(event.key === "Enter")
    })
  }
  form.addEventListener("focusout", () => {
    globalThis.setTimeout(() => { if (!form.contains(document.activeElement)) finish(changed()) }, 0)
  })
  check()
  return form
}

export const textAsk = ({ place, name }: NamedText, phrase: string, sources: ReadonlyArray<PageSource>, actions: TextActions): HTMLElement => {
  const id = place.planned.id
  const lines = linesOfPlace(place)
  const removed = place.state === "dropped" && place.reason === "removed"
  const facts = [`на словах «${phrase}»`, ...place.state === "shown" ? [formatLength(place.shown.start)] : [], ...place.answer === undefined ? [] : [DONE[place.answer.answer]]]
  const answer = (one: TextAnswer): void => { actions.answerText(one) }
  const shown = linesView(lines, removed)
  const retype = choice("Исправить", "Написать надпись своими словами", place.answer?.answer === "retyped", `retype-text:${id}`, () => {
    const form = editor(name, id, lines, (typed) => { answer({ id, answer: "retyped", lines: typed }) }, () => {
      const focused = form.contains(document.activeElement)
      shown.hidden = false
      form.replaceWith(acts)
      if (focused) retype.focus()
    })
    shown.hidden = true
    acts.replaceWith(form)
    form.querySelector("input")?.focus()
  })
  const acts = h("div", { class: "ask__acts" },
    button("quiet", "Посмотреть", {
      title: "Секунду до надписи, саму надпись и секунду после, как в ролике", disabled: place.state !== "shown", "data-key": `show-text:${id}`,
      click: () => { if (place.state === "shown") actions.showText({ start: place.shown.start, end: place.shown.end }) }
    }, "play"),
    choice("Оставить", "Надпись встанет в ролик как есть", place.answer?.answer === "keep", `keep-text:${id}`, () => { answer({ id, answer: "keep" }) }),
    retype,
    choice("Убрать", "Надписи не будет в ролике", removed, `remove-text:${id}`, () => { answer({ id, answer: "remove" }) }))
  return card(place.answer === undefined, `text:${id}`,
    h("p", { class: "ask__title" }, h("b", {}, name), ` · ${facts.join(" · ")}`),
    shown,
    ...articleWarnings(sources, lines.map((line) => line.text).join(" ")),
    ...place.answer?.answer === "retyped" ? [h("p", { class: "hint" }, `Предложено: «${place.planned.lines.map((line) => line.text).join(" ")}»`)] : [],
    acts)
}

export const droppedText = (name: string, place: DroppedText, nameOf: (id: string) => string, sources: ReadonlyArray<PageSource>): HTMLElement =>
  h("li", { class: "thought thought--off" },
    h("b", {}, name),
    linesView(linesOfPlace(place), false),
    h("span", { class: "hint thought__why" }, whyDropped(place, nameOf)),
    ...articleWarnings(sources, linesOfPlace(place).map((line) => line.text).join(" ")))
