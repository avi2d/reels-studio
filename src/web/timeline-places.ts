import { AROUND_JOIN_SECONDS, openPlaces, type Join, type Place } from "../shared/joins.ts"
import type { JoinAnswer, Placed } from "../shared/timeline.ts"
import { button, spoken } from "./controls.ts"
import { h } from "./dom.ts"

export interface PlaceActions {
  readonly hearJoin: (join: Join) => void
  readonly hearUnaligned: (join: Join) => void
  readonly answer: (join: Join, answer: JoinAnswer) => void
}

export interface PlaceCoverage {
  readonly waiting: boolean
  readonly failed: ReadonlyArray<string>
}

interface AnswerText {
  readonly label: string
  readonly does: string
  readonly done: string
}

const ANSWERS: ReadonlyArray<readonly [JoinAnswer, AnswerText]> = [
  ["zoom", {
    label: "Выровнять",
    does: "Студия чуть приближает картинку после склейки, чтобы глаза остались на той же высоте.",
    done: "картинка после склейки приближена"
  }],
  ["trim", {
    label: "Обрезать",
    does: "Студия убирает кадры с опущенным взглядом у склейки. Она режет только картинку над тишиной, а слова не трогает.",
    done: "опущенный взгляд обрезан"
  }],
  ["leave", { label: "Оставить как есть", does: "Склейка остаётся такой, как сейчас.", done: "склейка остаётся" }]
]

const seconds = (value: number): string => `${value.toFixed(1).replace(".", ",")} с`

const percent = (scale: number): string => `${Math.round((scale - 1) * 100)} %`

const doneText = ({ answer, trim, align }: Place, text: AnswerText): string => {
  if (answer === "trim") return `${text.done}: ${seconds(trim.cut)}`
  if (answer === "zoom" && align.kind === "zoom") return `${text.done} на ${percent(align.frame.scale)}`
  return text.done
}

const doneOf = (place: Place): ReadonlyArray<string> =>
  ANSWERS.flatMap(([one, text]) => one !== place.answer ? [] : [doneText(place, text)])

const alignNote = ({ align, answer }: Place): string => {
  if (answer !== undefined) return ""
  if (align.kind === "zoom") return `глаза можно выровнять: картинка после склейки станет крупнее на ${percent(align.frame.scale)}`
  if (align.kind === "far") return "выровнять нельзя: сдвиг слишком большой, приближением его не скрыть"
  return "студия ещё измеряет кадр, выровнять можно будет позже"
}

const bare = (word: string): string => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")

const wordNote = ({ trim }: Place): string | undefined =>
  trim.spoken === undefined ? undefined : `взгляд опущен и на слове «${bare(trim.spoken)}», а слова студия не режет`

const trimNote = (place: Place): string => {
  const word = wordNote(place)
  if (place.answer !== undefined) return word ?? ""
  if (place.trim.cut === 0) return word === undefined ? "опущенного взгляда нет, обрезать нечего" : `${word}, поэтому обрезать нечего`
  const can = `опущенный взгляд можно обрезать: ${seconds(place.trim.cut)}`
  return word === undefined ? can : `${can}, но ${word}`
}

const offered = (place: Place): ReadonlyArray<readonly [JoinAnswer, AnswerText]> =>
  ANSWERS.filter(([answer]) => answer === "leave" || (answer === "trim" ? place.trim.cut > 0 : place.align.kind === "zoom"))

const blockNumber = (placed: ReadonlyArray<Placed>, block: string): number => placed.findIndex((one) => one.block.id === block) + 1

const whereOf = (join: Join, placed: ReadonlyArray<Placed>): string => {
  const before = blockNumber(placed, join.end.block)
  const after = blockNumber(placed, join.start.block)
  return before === after ? `в блоке ${before}, на месте убранной паузы` : `между блоками ${before} и ${after}`
}

const edgeKey = (join: Join): string => `${join.end.video}:${join.end.end}:${join.start.video}:${join.start.start}`

const placeItem = (place: Place, number: number, placed: ReadonlyArray<Placed>, actions: PlaceActions): HTMLElement => {
  const where = whereOf(place.join, placed)
  const key = edgeKey(place.join)
  return h("li", { class: place.answer === undefined ? "pause-row place" : "pause-row place answered" },
    h("span", { class: "where" },
      h("b", {}, `Склейка ${number}`),
      h("span", {}, [where, ...doneOf(place)].join(" · ")),
      ...[alignNote(place), trimNote(place)].filter((note) => note !== "").map((note) => h("span", { class: "muted" }, note))),
    h("div", { class: "take-acts" },
      button("normal", {
        title: "Полторы секунды до склейки и полторы после, как в ролике",
        "data-key": `hear-join:${key}`,
        click: () => { actions.hearJoin(place.join) }
      }, ...spoken("Посмотреть", `Посмотреть склейку ${number}, ${where}`)),
      ...(place.answer === "zoom"
        ? [button("normal", {
          title: "Те же секунды без выравнивания",
          "data-key": `hear-unaligned:${key}`,
          click: () => { actions.hearUnaligned(place.join) }
        }, ...spoken("Как было", `Посмотреть склейку ${number} без выравнивания`))]
        : []),
      ...offered(place).map(([answer, { label, does }]) => button(place.answer === answer ? "primary" : "quiet", {
        title: does,
        "data-key": `answer-join:${answer}:${key}`,
        "aria-pressed": String(place.answer === answer),
        click: () => { actions.answer(place.join, answer) }
      }, ...spoken(label, `${label}: склейка ${number}`)))))
}

const countOf = (places: ReadonlyArray<Place>, coverage: PlaceCoverage): string => {
  const open = openPlaces(places)
  const failed = coverage.failed.length === 0 ? "" : ` Взгляд не удалось измерить в видео: ${coverage.failed.join(", ")}. Проверка этих склеек неполная.`
  if (places.length === 0) {
    if (!coverage.waiting && failed === "") return "Голова нигде не прыгает на склейках."
    if (!coverage.waiting) return `Мест для проверки пока нет.${failed}`
    return `Студия ещё измеряет, где голова в кадре. Места появятся, когда она закончит.${failed}`
  }
  const done = open === 0 ? `Все места проверены: ${places.length}.` : `Осталось проверить ${open} из ${places.length}.`
  const waiting = coverage.waiting ? " Студия ещё измеряет, мест может стать больше." : ""
  return `${done}${waiting}${failed}`
}

export const placeList = (places: ReadonlyArray<Place>, placed: ReadonlyArray<Placed>, coverage: PlaceCoverage, actions: PlaceActions): HTMLElement =>
  h("div", { class: "detail places-detail", "data-scroll-key": "places" },
    h("h3", {}, "Места для проверки"),
    h("p", { class: "did" }, `На этих склейках голова заметно сдвигается. Посмотрите каждую: студия покажет ${String(AROUND_JOIN_SECONDS).replace(".", ",")} с до склейки и столько же после, так, как склейка будет в ролике.`),
    h("ul", { class: "answers-said" }, ...ANSWERS.map(([, { label, does }]) => h("li", {}, h("b", {}, `«${label}».`), ` ${does}`))),
    ...(coverage.waiting ? [h("p", { class: "muted", role: "status" }, "Студия ещё измеряет, где голова в кадре. Места появятся, когда она закончит.")] : []),
    h("p", { class: "muted", role: "status" }, countOf(places, coverage)),
    h("ol", { class: "place-list" }, ...places.map((place, index) => placeItem(place, index + 1, placed, actions))))
