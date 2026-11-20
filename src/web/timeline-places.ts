import { AROUND_JOIN_SECONDS, openPlaces, type Join, type Place } from "../shared/joins.ts"
import type { JoinAnswer, Placed } from "../shared/timeline.ts"
import { button, spoken } from "./controls.ts"
import { h } from "./dom.ts"

export interface PlaceActions {
  readonly hearJoin: (join: Join) => void
  readonly answer: (join: Join, answer: JoinAnswer) => void
}

const ANSWERS: ReadonlyArray<readonly [JoinAnswer, string]> = [["leave", "Оставить"], ["plain", "Простая склейка"]]

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
      h("span", {}, where)),
    h("div", { class: "take-acts" },
      button("normal", {
        title: "Полторы секунды до склейки и полторы после",
        "data-key": `hear-join:${key}`,
        click: () => { actions.hearJoin(place.join) }
      }, ...spoken("Посмотреть", `Посмотреть склейку ${number}, ${where}`)),
      ...ANSWERS.map(([answer, label]) => button(place.answer === answer ? "primary" : "quiet", {
        "data-key": `answer-join:${answer}:${key}`,
        "aria-pressed": String(place.answer === answer),
        click: () => { actions.answer(place.join, answer) }
      }, ...spoken(label, `${label}: склейка ${number}`)))))
}

const countOf = (places: ReadonlyArray<Place>): string => {
  const open = openPlaces(places)
  if (places.length === 0) return "Голова нигде не прыгает на склейках."
  return open === 0 ? `Все места проверены: ${places.length}.` : `Осталось проверить ${open} из ${places.length}.`
}

export const placeList = (places: ReadonlyArray<Place>, placed: ReadonlyArray<Placed>, measuring: boolean, actions: PlaceActions): HTMLElement =>
  h("div", { class: "detail" },
    h("h3", {}, "Места для проверки"),
    h("p", { class: "did" }, `На этих склейках голова заметно сдвигается. Посмотрите каждую: студия покажет ${String(AROUND_JOIN_SECONDS).replace(".", ",")} с до склейки и столько же после.`),
    ...(measuring ? [h("p", { class: "muted", role: "status" }, "Студия ещё измеряет, где голова в кадре. Места появятся, когда она закончит.")] : []),
    h("p", { class: "muted", role: "status" }, countOf(places)),
    h("ol", { class: "place-list" }, ...places.map((place, index) => placeItem(place, index + 1, placed, actions))))
