import { Effect } from "effect"
import { plateOf, wordLookOf, type ShownPlate, type WordLook } from "../../shared/captions.ts"
import { BRAND_SUBTITLES, PLATE_LONGEST, type LooksView, type NamePlate, type NewLooks, type SubtitleLook, type SubtitleSize, type SubtitleStyle } from "../../shared/looks.ts"
import type { Clip } from "../../shared/timeline.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { paintSubtitle } from "../timeline-subtitles.ts"
import { button } from "./ui.ts"

const STYLES = [["brand", "Ваш стиль"], ["plate", "Жёлтая плашка"], ["example", "Как в примере"]] as const satisfies ReadonlyArray<readonly [SubtitleStyle, string]>
const SIZES = [["normal", "Обычные"], ["large", "Крупные"]] as const satisfies ReadonlyArray<readonly [SubtitleSize, string]>
const SAMPLE = "неправда"
const NO_EXAMPLE = "Чтобы выбрать «Как в примере», приложите к заданию или в чате ролик, на который хотите быть похожи."
const TOOK = "Из примера студия взяла:"
const SAVE_AFTER_MS = 600

const pixels = (size: number): string => `${(size / 1080 * 100).toFixed(2)}cqw`

// The preview draws the same look the reel burns, from the same numbers.
const paintLook = (node: HTMLElement, look: WordLook): void => {
  node.dataset["font"] = look.font
  node.style.setProperty("--sub-size", pixels(look.size))
  node.style.setProperty("--sub-colour", look.colour)
  node.style.setProperty("--sub-stroke", look.outline ?? "transparent")
  node.style.setProperty("--sub-box", look.box ?? "transparent")
  node.style.setProperty("--sub-case", look.capitals ? "uppercase" : "none")
  node.toggleAttribute("data-box", look.box !== undefined)
}

const styleCards = (choose: (change: Partial<SubtitleLook>) => void) => STYLES.map(([style, name]) => {
  const demo = h("span", { class: "look-card__demo" }, h("span", { class: "look-card__word" }, SAMPLE))
  const card = h("button", { class: "look-card", type: "button", role: "radio", "aria-checked": "false", click: () => { choose({ style }) } },
    demo, h("span", { class: "look-card__name" }, name))
  return { style, card, demo }
})

const paintCards = (cards: ReturnType<typeof styleCards>, view: LooksView): void => {
  for (const { style, card, demo } of cards) {
    card.setAttribute("aria-checked", String(view.subtitles.style === style))
    const missing = style === "example" && view.example === undefined
    card.disabled = missing
    if (missing) card.setAttribute("aria-describedby", "look-example-note")
    else card.removeAttribute("aria-describedby")
    paintLook(demo, wordLookOf({ style, size: "normal" }, view.example?.subtitles))
  }
}

const exampleLines = (view: LooksView): ReadonlyArray<Node | string> =>
  view.example === undefined ? [NO_EXAMPLE] : [h("p", {}, TOOK), h("ul", {}, ...view.example.took.map((line) => h("li", {}, line)))]

interface PlateControls {
  readonly node: HTMLElement
  readonly shown: HTMLInputElement
  readonly text: HTMLInputElement
  readonly textRow: HTMLElement
}

const plateControls = (onSwitch: () => void, onType: () => void): PlateControls => {
  const shown = h("input", { type: "checkbox", class: "look-switch", role: "switch", id: "look-plate-shown", change: onSwitch })
  const text = h("input", { class: "field", type: "text", id: "look-plate-text", maxlength: String(PLATE_LONGEST), autocomplete: "off", placeholder: "Имя и кем вы работаете", input: onType, change: onSwitch })
  const textRow = h("div", { class: "look-plate-text" }, h("label", { for: "look-plate-text" }, "Текст плашки"), text)
  const node = h("div", { class: "look-row" },
    h("span", { class: "look-row__label" }, "Надписи"),
    h("div", { class: "look-row__control" }, h("label", { class: "look-toggle", for: "look-plate-shown" }, shown, "Плашка с именем"), textRow))
  return { node, shown, text, textRow }
}

const framePreview = () => {
  const word = h("span", { class: "look-word" })
  const subtitle = h("div", { class: "subtitle-preview look-subtitle", "aria-hidden": "true" }, word)
  const text = h("span", {})
  const plate = h("div", { class: "plate-preview", "aria-hidden": "true", hidden: true }, text)
  const paint = (look: WordLook, said: string, named: ShownPlate | undefined, at: number | undefined): void => {
    paintLook(subtitle, look)
    paintSubtitle(word, said)
    plate.hidden = named === undefined || (at !== undefined && (at < named.start || at >= named.end))
    text.textContent = named?.text ?? ""
  }
  return { subtitle, plate, paint }
}

export interface LookSubtitles {
  readonly node: HTMLElement
  readonly refresh: () => void
  readonly subtitle: HTMLElement
  readonly plate: HTMLElement
  // at is the reel time while it plays, and undefined while it stands still.
  readonly paintFrame: (word: string, at: number | undefined, clips: ReadonlyArray<Clip>) => void
  readonly dispose: () => void
}

export const lookSubtitles = (projectId: string, onChange: (view: LooksView) => void): LookSubtitles => {
  const state: { view: LooksView | undefined; confirmed: LooksView | undefined; asked: number; timer: number } = { view: undefined, confirmed: undefined, asked: 0, timer: 0 }
  const cards = styleCards((change) => { choose(change) })
  const sizes = SIZES.map(([size, name]) => ({ size, choice: button("quiet", name, { "aria-pressed": "false", click: () => { choose({ size }) } }) }))
  const exampleNote = h("div", { class: "hint look-example", id: "look-example-note" })
  const { node: plateRow, shown, text, textRow } = plateControls(() => { savePlate() }, () => { savePlateLater() })
  const problem = h("p", { class: "error", role: "alert" })
  const preview = framePreview()
  const node = h("section", { class: "group look-settings", "aria-labelledby": "look-subtitles" },
    h("h2", { class: "group__title", id: "look-subtitles" }, "Субтитры"),
    h("div", { class: "look-row" },
      h("span", { class: "look-row__label", id: "look-style-title" }, "Вид"),
      h("div", { class: "look-row__control" },
        h("div", { class: "look-cards", role: "radiogroup", "aria-labelledby": "look-style-title" }, ...cards.map((one) => one.card)),
        exampleNote)),
    h("div", { class: "look-row" },
      h("span", { class: "look-row__label", id: "look-size-title" }, "Размер"),
      h("div", { class: "look-row__control" }, h("div", { class: "seg", role: "group", "aria-labelledby": "look-size-title" }, ...sizes.map((one) => one.choice)))),
    plateRow,
    problem)

  const show = (view: LooksView): void => {
    state.view = view
    paintCards(cards, view)
    for (const { size, choice } of sizes) {
      const on = view.subtitles.size === size
      choice.className = `btn btn--${on ? "main" : "quiet"}`
      choice.setAttribute("aria-pressed", String(on))
    }
    exampleNote.replaceChildren(...exampleLines(view))
    shown.checked = view.plate.shown
    textRow.hidden = !view.plate.shown
    if (document.activeElement !== text) text.value = view.plate.text
    onChange(view)
  }

  const ask = (call: Effect.Effect<LooksView, Api.Failed>): void => {
    state.asked += 1
    const asked = state.asked
    Effect.runFork(call.pipe(
      Effect.map((view) => {
        if (asked !== state.asked) return
        state.confirmed = view
        show(state.timer === 0 || state.view === undefined ? view : { ...view, plate: state.view.plate })
      }),
      Effect.catchTag("Failed", (error) => Effect.sync(() => {
        if (asked !== state.asked) return
        if (state.confirmed !== undefined) show(state.confirmed)
        problem.textContent = error.message
      }))
    ))
  }

  const save = (change: NewLooks): void => {
    problem.textContent = ""
    ask(Api.setLooks(projectId, change))
  }

  function choose(change: Partial<SubtitleLook>): void {
    const now = state.view?.subtitles
    if (now === undefined) return
    const next = { ...now, ...change }
    if (next.style === now.style && next.size === now.size) return
    state.view = state.view === undefined ? undefined : { ...state.view, subtitles: next }
    if (state.view !== undefined) show(state.view)
    save({ subtitles: next })
  }

  const plateNow = (): NamePlate => ({ shown: shown.checked, text: text.value.slice(0, PLATE_LONGEST) })

  function savePlate(): void {
    globalThis.clearTimeout(state.timer)
    state.timer = 0
    const chosen = plateNow()
    textRow.hidden = !chosen.shown
    if (chosen.shown && document.activeElement !== text && chosen.text.trim() === "") text.focus()
    if (state.view !== undefined) show({ ...state.view, plate: chosen })
    save({ plate: chosen })
  }

  function savePlateLater(): void {
    globalThis.clearTimeout(state.timer)
    if (state.view !== undefined) show({ ...state.view, plate: plateNow() })
    state.timer = Number(globalThis.setTimeout(savePlate, SAVE_AFTER_MS))
  }

  return {
    node,
    refresh: () => {
      if (node.isConnected) ask(Api.getLooks(projectId))
    },
    subtitle: preview.subtitle,
    plate: preview.plate,
    paintFrame: (said, at, clips) => {
      const { view } = state
      preview.paint(wordLookOf(view?.subtitles ?? BRAND_SUBTITLES, view?.example?.subtitles), said, view === undefined ? undefined : plateOf(view.plate, clips), at)
    },
    dispose: () => {
      if (state.timer !== 0) savePlate()
    }
  }
}
