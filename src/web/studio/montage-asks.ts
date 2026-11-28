import type { InsertPlace } from "../../shared/inserts.ts"
import type { Place } from "../../shared/joins.ts"
import type { Span } from "../../shared/plan.ts"
import type { InsertAnswer } from "../../shared/timeline.ts"
import type { PageSource } from "../../shared/web-pages.ts"
import { h } from "../dom.ts"
import { formatLength } from "../format.ts"
import { canReplace, doneOf as insertDone, KEEP, KEEP_CLIP, pictureChooser, REMOVE, REPLACE, SOUND } from "../timeline-inserts.ts"
import { alignNote, COVER, doneOf as joinDone, offered, type PlaceActions, trimNote } from "../timeline-places.ts"
import { visualName } from "../timeline-row.ts"
import { joinKey, wordKey, type Numbered, type WordPlace } from "./montage-model.ts"
import { articleWarnings, sourceKind, sourceLines, sourceOf } from "./page-source.ts"
import { button, card, choice } from "./ui.ts"

export interface InsertData {
  readonly pictures: ReadonlyArray<string>
  readonly sources: ReadonlyArray<PageSource>
}

export interface AskActions extends PlaceActions {
  readonly showInsert: (span: Span) => void
  readonly answerInsert: (answer: InsertAnswer) => void
  readonly visualUrl: (visual: InsertPlace["visual"]) => string
  readonly hearWord: (block: string, video: string, index: number) => void
  readonly fixWord: (block: string, video: string, index: number, text: string) => void
}

export const joinAsk = ({ place, number }: Numbered<Place>, inside: boolean, pictures: ReadonlyArray<string>, actions: AskActions): HTMLElement => {
  const key = joinKey(place.join)
  const where = inside ? "на месте убранной паузы" : "с прошлой частью"
  const done = joinDone(place)
  const cover = place.answered?.answer === "cover" ? place.answered.picture : undefined
  const notes = [alignNote(place), trimNote(place)].filter((note) => note !== "")
  return card(place.answer === undefined, `join:${key}`,
    h("p", { class: "ask__title" }, h("b", {}, `Склейка ${number}`), ` ${where}`, ...done.length === 0 ? [] : [` · ${done.join(", ")}`]),
    ...place.answer === undefined ? [h("p", {}, "На склейке голова заметно сдвигается. Посмотрите её и выберите, что сделать.")] : [],
    ...notes.map((note) => h("p", { class: "hint" }, note)),
    h("div", { class: "ask__acts" },
      button("quiet", "Посмотреть", { title: "Полторы секунды до склейки и полторы после, как в ролике", "data-key": `hear-join:${key}`, click: () => { actions.hearJoin(place.join) } }, "play"),
      ...place.answer === "zoom"
        ? [button("quiet", "Как было", { title: "Те же секунды без выравнивания", "data-key": `hear-unaligned:${key}`, click: () => { actions.hearUnaligned(place.join) } })]
        : [],
      ...offered(place).map(([one, { label, does }]) => choice(label, does, place.answer === one, `answer-join:${one}:${key}`, () => { actions.answer(place.join, one) }))),
    ...pictures.length === 0 ? [] : [pictureChooser({ ...COVER, name: `${COVER.label}: склейка ${number}` }, `cover-join:${key}`, pictures,
      { picture: cover, chosen: cover !== undefined }, actions.pictureUrl, (picture) => { actions.cover(place.join, picture) })])
}

const wordDone = (place: WordPlace, shown: string): string | undefined => {
  switch (place.answer) {
    case undefined: return undefined
    case "fix": return `взято «${shown}»`
    case "heard": return "оставлено как услышано"
    case "typed": return `исправлено на «${shown}»`
  }
}

export const wordAsk = (block: string, { place, number }: Numbered<WordPlace>, shown: string, actions: AskActions): HTMLElement => {
  const key = wordKey(place)
  const done = wordDone(place, shown)
  const { fix, heard } = place
  const answer = (text: string) => (): void => { actions.fixWord(block, place.video, place.index, text) }
  return card(place.answer === undefined, `word:${key}`,
    h("p", { class: "ask__title" }, h("b", {}, `Слово ${number}`), ` «${heard}»`, ...done === undefined ? [] : [` · ${done}`]),
    ...place.answer === undefined
      ? [h("p", {}, fix === undefined
        ? "Студия не уверена, что расслышала это слово. Послушайте его. Если оно неверное, нажмите на него в тексте ниже и исправьте."
        : `Студия не уверена, что расслышала это слово. Похоже, здесь «${fix}».`)]
      : [],
    ...place.reason === "" ? [] : [h("p", { class: "hint" }, place.reason)],
    h("div", { class: "ask__acts" },
      button("quiet", "Послушать", { title: "Секунду до слова, само слово и секунду после, как в ролике", "data-key": `hear-word:${key}`, click: () => { actions.hearWord(block, place.video, place.index) } }, "play"),
      ...fix === undefined ? [] : [choice(`Взять «${fix}»`, "Поставить это слово в субтитры", place.answer === "fix", `fix-word:${key}`, answer(fix))],
      choice(`Оставить «${heard}»`, "Оставить слово, как студия его услышала", place.answer === "heard", `keep-word:${key}`, answer(heard))))
}

const KIND_NAMES = { picture: "Картинка", clip: "Видео", page: "Страница документа" } satisfies Record<InsertPlace["visual"]["kind"], string>

const insertFacts = (place: InsertPlace, phrase: string): string => {
  const { span } = place
  const done = insertDone(place)
  return [`на словах «${phrase}»`, ...span === undefined ? [] : [formatLength(span.start)], ...done === undefined ? [] : [done]].join(" · ")
}

export const insertAsk = ({ place, number }: Numbered<InsertPlace>, phrase: string, data: InsertData, actions: AskActions): HTMLElement => {
  const { planned, span, visual } = place
  const { pictures } = data
  const source = sourceOf(visual, data.sources)
  const id = planned.id
  const answer = (one: InsertAnswer): void => { actions.answerInsert(one) }
  return card(place.answer === undefined && span !== undefined, `insert:${id}`,
    h("div", { class: "insert" },
      h("img", { class: place.answer === "remove" ? "insert__art insert__art--off" : "insert__art", src: actions.visualUrl(visual), alt: "" }),
      h("p", { class: "insert__text" },
        h("b", {}, `Вставка ${number}. ${source === undefined ? KIND_NAMES[visual.kind] : sourceKind(source)}`),
        h("span", {}, source === undefined || visual.kind !== "page" ? visualName(visual) : `Страница ${visual.page}`),
        ...source === undefined ? [] : sourceLines(source),
        h("span", { class: "hint" }, insertFacts(place, phrase)),
        ...planned.reason === "" ? [] : [h("span", { class: "hint" }, planned.reason)],
        ...articleWarnings(source === undefined ? [] : [source], phrase),
        ...span === undefined ? [h("span", { class: "hint" }, "Этой фразы сейчас нет в ролике, поэтому вставку не видно.")] : [])),
    h("div", { class: "ask__acts" },
      button("quiet", "Посмотреть", {
        title: "Секунду до вставки, саму вставку и секунду после, как в ролике", disabled: span === undefined, "data-key": `show-insert:${id}`,
        click: () => { if (span !== undefined) actions.showInsert(span) }
      }, "play"),
      choice(KEEP.label, visual.kind === "clip" ? KEEP_CLIP.does : KEEP.does, place.answer === "keep", `keep-insert:${id}`, () => { answer({ id, answer: "keep" }) }),
      ...visual.kind === "clip" ? [choice(SOUND.label, SOUND.does, place.answer === "sound", `sound-insert:${id}`, () => { answer({ id, answer: "sound" }) })] : [],
      choice(REMOVE.label, REMOVE.does, place.answer === "remove", `remove-insert:${id}`, () => { answer({ id, answer: "remove" }) })),
    ...!canReplace(place, pictures) ? [] : [pictureChooser({ ...REPLACE, name: `${REPLACE.label}: вставка ${number}` }, `replace-insert:${id}`, pictures,
      { picture: visual.kind === "picture" ? visual.file : undefined, chosen: place.answer === "replace" }, actions.pictureUrl,
      (picture) => { answer({ id, answer: "replace", picture }) })])
}
