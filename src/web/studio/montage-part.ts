import { lengthOf, type Transcript } from "../../shared/plan.ts"
import { bareWord } from "../../shared/subtitles.ts"
import { playedSpans, type Block, type Edits, type Pause, type Placed, type Take } from "../../shared/timeline.ts"
import { h } from "../dom.ts"
import { formatLength, formatPause } from "../format.ts"
import { isAsked } from "../text-names.ts"
import type { EditableSubtitle } from "../timeline-subtitles.ts"
import { icon } from "./icons.ts"
import { insertAsk, joinAsk, wordAsk, type AskActions } from "./montage-asks.ts"
import type { Part } from "./montage-model.ts"
import { droppedText, textAsk, type TextActions } from "./montage-texts.ts"
import { zoomGroup, type ZoomActions } from "./montage-zooms.ts"
import { button, menuButton } from "./ui.ts"

export interface PartActions extends AskActions, TextActions, ZoomActions {
  readonly choose: (block: string, take: Take) => void
  readonly hearTake: (block: string, take: Take) => void
  readonly hearPause: (one: Placed, pause: Pause) => void
  readonly setPause: (video: string, after: number, removed: boolean) => void
  readonly move: (block: string, by: -1 | 1) => void
  readonly remove: (block: string) => void
  readonly restore: (block: string) => void
}

export interface PartData {
  readonly count: number
  readonly rest: number
  readonly transcripts: ReadonlyMap<string, Transcript>
  readonly edits: Edits
  readonly pictures: ReadonlyArray<string>
  readonly words: ReadonlyArray<EditableSubtitle>
  readonly phraseOf: (phrase: { readonly video: string; readonly from: number; readonly to: number }) => string
  readonly textName: (id: string) => string
}

const group = (title: string, ...children: ReadonlyArray<Node>): HTMLElement =>
  h("section", { class: "group" }, h("h3", { class: "group__title" }, title), ...children)

const headOf = (number: number, data: PartData, title: string, ...acts: ReadonlyArray<Node>): HTMLElement =>
  h("div", { class: "detail__head" },
    h("div", {}, h("p", { class: "eyebrow" }, `Часть ${number} из ${data.count}`), h("h2", { id: "part-title", tabindex: "-1" }, title)),
    ...acts)

const wordButton = (one: Placed, word: EditableSubtitle, data: PartData, doubtful: boolean, actions: PartActions): HTMLElement => {
  const { block, take } = one
  const key = `word:${block.id}:${take.video}:${word.index}`
  const heard = bareWord(data.transcripts.get(take.video)?.words[word.index]?.text ?? "")
  const node = h("button", { type: "button", "data-key": key }, word.text)
  const showWord = (text: string): void => {
    const fixed = text !== heard
    node.textContent = text
    node.className = fixed ? "word word--fixed" : doubtful ? "word word--doubt" : "word"
    node.title = fixed ? "Исправлено. Нажмите, чтобы изменить." : doubtful ? "Студия не уверена в этом слове. Нажмите, чтобы исправить." : "Исправить слово"
  }
  showWord(word.text)
  node.addEventListener("click", () => {
    const shown = node.textContent
    const field = h("input", { class: "word-field", value: shown, "aria-label": `Исправить слово «${shown}»`, "data-key": key, size: String(Math.max(3, shown.length + 1)) })
    let done = false
    const finish = (save: boolean): void => {
      if (done) return
      done = true
      const focused = document.activeElement === field
      const text = field.value.trim()
      field.blur()
      const saved = save && text !== "" && text !== shown
      if (saved) showWord(text)
      field.replaceWith(node)
      if (focused) node.focus()
      if (saved) actions.fixWord(block.id, take.video, word.index, text)
    }
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== "Escape") return
      event.preventDefault()
      finish(event.key === "Enter")
    })
    field.addEventListener("blur", () => { globalThis.setTimeout(() => { finish(true) }, 0) })
    node.replaceWith(field)
    field.focus()
    field.select()
  })
  return node
}

const wordsGroup = (part: Part, data: PartData, actions: PartActions): HTMLElement => {
  const id = part.one.block.id
  const doubtful = new Set(part.words.filter(({ place }) => place.answer === undefined).map(({ place }) => place.index))
  const shownOf = (index: number): string => data.words.find((word) => word.index === index)?.text ?? ""
  return group("Слова",
    ...part.words.map((place) => wordAsk(id, place, shownOf(place.place.index), actions)),
    h("p", { class: "hint" }, "Так слова встанут в субтитры. Нажмите на слово, которое студия услышала неверно, и исправьте его."),
    h("p", { class: "transcript" }, ...data.words.flatMap((word) => [wordButton(part.one, word, data, doubtful.has(word.index), actions), " "])))
}

const takeItem = (one: Placed, take: Take, data: PartData, actions: PartActions): HTMLElement => {
  const rank = one.block.takes.indexOf(take) + 1
  const name = rank === 1 ? "Лучший дубль" : `Дубль ${rank}`
  const transcript = data.transcripts.get(take.video)
  const length = transcript === undefined ? undefined : lengthOf(playedSpans(transcript, take, data.edits, data.rest))
  const facts = [...length === undefined ? [] : [formatLength(length)], ...take.camera === undefined ? [] : [`в камеру ${Math.round(take.camera * 100)}%`], take.video]
  const chosen = take === one.take
  const key = `${one.block.id}:${take.video}:${take.from}`
  return h("li", { class: chosen ? "take take--on" : "take" },
    h("div", { class: "take__text" }, h("b", {}, name), h("span", { class: "hint" }, facts.join(" · ")), ...take.reason === "" ? [] : [h("span", { class: "hint" }, take.reason)]),
    h("div", { class: "take__acts" },
      button("quiet", "Смотреть", { "aria-label": `Смотреть: ${name}`, "data-key": `hear-take:${key}`, click: () => { actions.hearTake(one.block.id, take) } }, "play"),
      chosen
        ? h("span", { class: "take__in" }, icon("check"), "В ролике")
        : button("quiet", "Взять", { "aria-label": `Взять: ${name}`, "data-key": `take:${key}`, click: () => { actions.choose(one.block.id, take) } })))
}

const pauseItem = (one: Placed, pause: Pause, data: PartData, actions: PartActions): HTMLElement => {
  const after = data.transcripts.get(one.take.video)?.words[pause.after]?.text ?? ""
  const key = `${one.take.video}:${pause.after}`
  const set = (removed: boolean) => (): void => { actions.setPause(one.take.video, pause.after, removed) }
  return h("li", { class: "pause" },
    h("span", { class: "pause__text" }, `${formatPause(pause.end - pause.start)} после «${after}»`),
    h("div", { class: "seg", role: "group", "aria-label": `Пауза после «${after}»` },
      button(pause.removed ? "main" : "quiet", "Убрать", { "aria-pressed": String(pause.removed), "data-key": `cut-pause:${key}`, click: set(true) }),
      button(pause.removed ? "quiet" : "main", "Оставить", { "aria-pressed": String(!pause.removed), "data-key": `keep-pause:${key}`, click: set(false) })),
    button("plain", "Послушать", { "aria-label": `Послушать паузу после «${after}»`, "data-key": `hear-pause:${key}`, click: () => { actions.hearPause(one, pause) } }))
}

const joinGroup = (part: Part, data: PartData, actions: PartActions): ReadonlyArray<HTMLElement> => {
  const { one, joins } = part
  if (one.pauses.length === 0 && joins.length === 0) return []
  return [group("Склейка",
    ...joins.map((place) => joinAsk(place, place.place.join.end.block === one.block.id, data.pictures, actions)),
    ...one.pauses.length === 0 ? [] : [
      h("p", { class: "hint" }, "Паузы в этом дубле. Убранная пауза становится склейкой."),
      h("ul", { class: "pauses" }, ...one.pauses.map((pause) => pauseItem(one, pause, data, actions)))])]
}

export const screenGroup = (part: Pick<Part, "texts" | "inserts">, data: PartData, actions: PartActions, title = "На экране"): ReadonlyArray<HTMLElement> => {
  if (part.texts.length === 0 && part.inserts.length === 0) return []
  const dropped = part.texts.flatMap(({ place, name }) => place.state === "dropped" && !isAsked(place) ? [droppedText(name, place, data.textName)] : [])
  return [group(title,
    ...part.texts.flatMap((text) => isAsked(text.place) ? [textAsk(text, data.phraseOf(text.place.planned), actions)] : []),
    ...dropped.length === 0 ? [] : [h("ul", { class: "thoughts" }, ...dropped)],
    ...part.inserts.map((place) => insertAsk(place, data.phraseOf(place.place.planned), data.pictures, actions)))]
}

export const partDetail = (part: Part, data: PartData, actions: PartActions): HTMLElement => {
  const id = part.one.block.id
  const items = [
    ...part.number > 1 ? [{ label: "Выше", icon: "up" as const, danger: false, run: () => { actions.move(id, -1) } }] : [],
    ...part.number < data.count ? [{ label: "Ниже", icon: "lower" as const, danger: false, run: () => { actions.move(id, 1) } }] : [],
    { label: "Убрать часть", icon: "trash" as const, danger: true, run: () => { actions.remove(id) } }
  ]
  return h("div", { class: "detail" },
    headOf(part.number, data, part.one.block.title, h("span", { class: "detail__length" }, formatLength(part.length)), menuButton("Ещё", items)),
    wordsGroup(part, data, actions),
    ...part.one.block.takes.length < 2 ? [] : [group("Дубль", h("ul", { class: "takes" }, ...part.one.block.takes.map((take) => takeItem(part.one, take, data, actions))))],
    ...joinGroup(part, data, actions),
    ...zoomGroup(part.zooms, data.phraseOf, actions),
    ...screenGroup(part, data, actions))
}

export const goneDetail = (block: Block, take: Take, data: PartData, actions: PartActions): HTMLElement => {
  const words = data.transcripts.get(take.video)?.words.slice(take.from, take.to + 1).map((word) => word.text).join(" ") ?? ""
  return h("div", { class: "detail detail--gone" },
    h("div", { class: "detail__head" },
      h("div", {}, h("p", { class: "eyebrow" }, "Убрана из ролика"), h("h2", { id: "part-title", tabindex: "-1" }, block.title)),
      button("quiet", "Вернуть", { "data-key": `restore:${block.id}`, click: () => { actions.restore(block.id) } }, "retry")),
    h("p", { class: "quote" }, words))
}
