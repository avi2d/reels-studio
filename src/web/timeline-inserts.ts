import { openInserts, type InsertPlace } from "../shared/inserts.ts"
import type { Span } from "../shared/plan.ts"
import type { InsertAnswer, PlannedInsert, PlannedInserts } from "../shared/timeline.ts"
import { button, spoken } from "./controls.ts"
import { h } from "./dom.ts"
import { formatLength } from "./format.ts"
import { visualName } from "./timeline-row.ts"

export interface InsertActions {
  readonly pictureUrl: (picture: string) => string
  readonly visualUrl: (visual: InsertPlace["visual"]) => string
  readonly showInsert: (span: Span) => void
  readonly answerInsert: (answer: InsertAnswer) => void
  readonly ask: (text: string) => void
}

export interface InsertData {
  readonly planned: PlannedInserts
  readonly places: ReadonlyArray<InsertPlace>
  readonly pictures: ReadonlyArray<string>
  readonly phraseOf: (planned: PlannedInsert) => string
}

const ASK = "Предложи, на какие фразы ролика поставить мои картинки, видео и документы."

interface AnswerText {
  readonly label: string
  readonly does: string
}

const KEEP: AnswerText = { label: "Оставить", does: "Вставка остаётся в ролике." }
const KEEP_CLIP: AnswerText = { label: KEEP.label, does: "Вставка остаётся в ролике. Видео идёт без своего звука." }
const SOUND: AnswerText = { label: "Со звуком", does: "Видео остаётся в ролике, и его звук слышен вместе с вашим голосом." }
const REPLACE: AnswerText = { label: "Заменить", does: "На этом месте встанет другая картинка из тех, что вы прикрепили в чате." }
const REMOVE: AnswerText = { label: "Убрать", does: "Ролик идёт без этой вставки." }

export const pictureChooser = (
  text: { readonly label: string; readonly does: string; readonly name: string },
  key: string,
  pictures: ReadonlyArray<string>,
  current: { readonly picture: string | undefined; readonly chosen: boolean },
  pictureUrl: (picture: string) => string,
  pick: (picture: string) => void
): HTMLElement =>
  h("details", { class: current.chosen ? "chooser chosen" : "chooser", "data-key": key },
    h("summary", { title: text.does }, h("span", { "aria-hidden": "true" }, text.label), h("span", { class: "visually-hidden" }, text.name)),
    h("ul", { class: "choices" }, ...pictures.map((picture) => h("li", {},
      h("button", {
        type: "button",
        class: "choice-picture",
        "aria-pressed": String(picture === current.picture),
        "aria-label": `${text.name}: ${picture}`,
        title: picture,
        "data-key": `${key}:${picture}`,
        click: () => { pick(picture) }
      }, h("img", { src: pictureUrl(picture), alt: "", loading: "lazy" }), h("span", {}, picture))))),
    h("p", { class: "muted" }, "Новую картинку прикрепите в чате, и она появится здесь."))

const doneOf = (place: InsertPlace): string | undefined => {
  if (place.answer === "keep") return "остаётся"
  if (place.answer === "sound") return "остаётся со звуком"
  if (place.answer === "remove") return "убрана"
  if (place.answer === "replace") return `заменена на «${visualName(place.visual)}»`
  return undefined
}

const canReplace = (place: InsertPlace, pictures: ReadonlyArray<string>): boolean =>
  pictures.some((picture) => place.visual.kind !== "picture" || place.visual.file !== picture)

const insertItem = (place: InsertPlace, number: number, data: InsertData, actions: InsertActions): HTMLElement => {
  const { planned, span } = place
  const phrase = `на словах «${data.phraseOf(planned)}»`
  const at = span === undefined ? [] : [formatLength(span.start)]
  const done = doneOf(place)
  const notes = [planned.reason, ...(span === undefined ? ["Этой фразы сейчас нет в ролике, поэтому вставку не видно."] : [])]
  const answer = (one: InsertAnswer): void => { actions.answerInsert(one) }
  const chosen = (one: InsertAnswer["answer"]): "primary" | "quiet" => place.answer === one ? "primary" : "quiet"
  return h("li", { class: place.answer === undefined && span !== undefined ? "pause-row place insert" : "pause-row place insert answered" },
    h("img", { class: place.answer === "remove" ? "thumb removed" : "thumb", src: actions.visualUrl(place.visual), alt: "" }),
    h("span", { class: "where" },
      h("b", {}, `Вставка ${number}`),
      h("span", {}, [phrase, ...at, ...(done === undefined ? [] : [done])].join(" · ")),
      ...notes.filter((note) => note !== "").map((note) => h("span", { class: "muted" }, note))),
    h("div", { class: "take-acts" },
      button("normal", {
        title: "Секунду до вставки, саму вставку и секунду после, как в ролике",
        disabled: span === undefined,
        "data-key": `show-insert:${planned.id}`,
        click: () => { if (span !== undefined) actions.showInsert(span) }
      }, ...spoken("Посмотреть", `Посмотреть вставку ${number}`)),
      button(chosen("keep"), {
        title: place.visual.kind === "clip" ? KEEP_CLIP.does : KEEP.does,
        "aria-pressed": String(place.answer === "keep"),
        "data-key": `keep-insert:${planned.id}`,
        click: () => { answer({ id: planned.id, answer: "keep" }) }
      }, ...spoken(KEEP.label, `${KEEP.label}: вставка ${number}`)),
      ...(place.visual.kind !== "clip" ? [] : [button(chosen("sound"), {
        title: SOUND.does,
        "aria-pressed": String(place.answer === "sound"),
        "data-key": `sound-insert:${planned.id}`,
        click: () => { answer({ id: planned.id, answer: "sound" }) }
      }, ...spoken(SOUND.label, `${SOUND.label}: вставка ${number}`))]),
      ...(!canReplace(place, data.pictures) ? [] : [pictureChooser(
        { ...REPLACE, name: `${REPLACE.label}: вставка ${number}` },
        `replace-insert:${planned.id}`, data.pictures, { picture: place.visual.kind === "picture" ? place.visual.file : undefined, chosen: place.answer === "replace" }, actions.pictureUrl,
        (picture) => { answer({ id: planned.id, answer: "replace", picture }) })]),
      button(chosen("remove"), {
        title: REMOVE.does,
        "aria-pressed": String(place.answer === "remove"),
        "data-key": `remove-insert:${planned.id}`,
        click: () => { answer({ id: planned.id, answer: "remove" }) }
      }, ...spoken(REMOVE.label, `${REMOVE.label}: вставка ${number}`))))
}

const countOf = (places: ReadonlyArray<InsertPlace>): string => {
  const open = openInserts(places)
  return open === 0 ? `Все вставки проверены: ${places.length}.` : `Осталось проверить ${open} из ${places.length}.`
}

const statusOf = (data: InsertData, actions: InsertActions): ReadonlyArray<HTMLElement> => {
  const askButton = (label: string): HTMLElement => button("normal", { class: "end", click: () => { actions.ask(ASK) } }, label)
  const { planned } = data
  if (planned.state === "unreadable") return [h("p", { class: "error" }, "Вставки не прочитались. Попросите студию предложить их заново."), askButton("Предложить вставки заново")]
  if (planned.state !== "ready") return [h("p", { class: "muted" }, "Студия ещё не ставила вставки в ролик."), askButton("Предложить вставки")]
  const dropped = planned.dropped === 0 ? [] : [h("p", { class: "muted" }, `Студия пропустила вставки, для которых не нашла файл, строку документа или фразу: ${planned.dropped}. Попросите в чате предложить их заново.`)]
  return [...dropped, h("p", { class: "muted", role: "status" }, data.places.length === 0 ? "Вставок нет." : countOf(data.places))]
}

const answersSaid = (data: InsertData): ReadonlyArray<AnswerText> => {
  const clips = data.places.some((place) => place.visual.kind === "clip")
  return [clips ? KEEP_CLIP : KEEP, ...(clips ? [SOUND] : []), ...(data.places.some((place) => canReplace(place, data.pictures)) ? [REPLACE] : []), REMOVE]
}

export const insertList = (data: InsertData, actions: InsertActions): ReadonlyArray<HTMLElement> =>
  data.pictures.length === 0 && data.planned.state === "none" ? [] : [h("div", { class: "detail" },
    h("h3", {}, "Вставки"),
    h("p", { class: "did" }, "Пока звучит фраза, поверх видео стоит ваша картинка, видео или страница документа, а голос продолжается. Видео идёт без своего звука. На странице жёлтым отмечена строка, о которой вы говорите. Высокая вставка закрывает весь кадр, широкая встаёт карточкой над вами. Посмотрите каждую."),
    h("ul", { class: "answers-said" }, ...answersSaid(data).map(({ label, does }) => h("li", {}, h("b", {}, `«${label}».`), ` ${does}`))),
    ...statusOf(data, actions),
    h("ol", { class: "place-list" }, ...data.places.map((place, index) => insertItem(place, index + 1, data, actions))))]
