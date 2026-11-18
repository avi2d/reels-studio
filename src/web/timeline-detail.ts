import type { Transcript } from "../shared/plan.ts"
import { lengthOf } from "../shared/plan.ts"
import { MIN_PAUSE, PAUSE_REST, pausesOf, playedSpans, type Block, type Edits, type Pause, type Placed, type Take } from "../shared/timeline.ts"
import { button, spoken } from "./controls.ts"
import { h } from "./dom.ts"
import { formatLength, formatPause } from "./format.ts"

export interface DetailActions {
  readonly choose: (block: string, take: Take) => void
  readonly hear: (block: string, take: Take) => void
  readonly hearAround: (block: string, take: Take) => void
  readonly hearPause: (one: Placed, pause: Pause) => void
  readonly setDeleted: (block: string, deleted: boolean) => void
  readonly setPause: (video: string, after: number, removed: boolean) => void
}

const takeText = (transcript: Transcript, take: Take, edits: Edits): ReadonlyArray<Node | string> => {
  const pauses = pausesOf(transcript, take, edits)
  return transcript.words.slice(take.from, take.to + 1).flatMap((word, offset): ReadonlyArray<Node | string> => {
    const pause = pauses.find((one) => one.after === take.from + offset)
    if (pause === undefined) return [`${word.text} `]
    const mark = `пауза ${formatPause(pause.end - pause.start)}`
    return [`${word.text} `, pause.removed ? h("del", { class: "gap" }, mark) : h("span", { class: "gap" }, mark), " "]
  })
}

const takeItem = (block: Block, take: Take, chosen: Take, transcript: Transcript, edits: Edits, actions: DetailActions): HTMLElement => {
  const rank = block.takes.indexOf(take) + 1
  const facts = [
    ...(take.camera === undefined ? [] : [`в камеру ${Math.round(take.camera * 100)}%`]),
    formatLength(lengthOf(playedSpans(transcript, take, edits))),
    take.video
  ]
  const radio = h("input", {
    type: "radio",
    name: `take-${block.id}`,
    checked: take === chosen,
    "data-key": `take:${block.id}:${take.video}:${take.from}`,
    change: () => { actions.choose(block.id, take) }
  })
  return h("li", { class: take === chosen ? "take chosen" : "take" },
    h("label", { class: "choice" }, radio, h("span", {},
      h("span", { class: "name" }, rank === 1 ? "Лучший дубль" : `Дубль ${rank}`),
      h("span", { class: "words" }, ...takeText(transcript, take, edits)),
      h("span", { class: "muted" }, take.reason),
      h("span", { class: "facts" }, facts.join(" · ")))),
    h("div", { class: "take-acts" },
      button("normal", {
        "data-key": `hear:${block.id}:${take.video}:${take.from}`,
        click: () => { actions.hear(block.id, take) }
      }, ...spoken("Послушать", `Послушать дубль ${rank}`)),
      button("normal", {
        title: "Конец блока до него, этот дубль и начало блока после",
        "data-key": `around:${block.id}:${take.video}:${take.from}`,
        click: () => { actions.hearAround(block.id, take) }
      }, ...spoken("С соседями", `Послушать дубль ${rank} с соседними блоками`))))
}

export const blockDetail = (
  block: Block,
  number: number,
  chosen: Take,
  transcripts: ReadonlyMap<string, Transcript>,
  edits: Edits,
  actions: DetailActions
): HTMLElement =>
  h("div", { class: "detail" },
    h("div", { class: "detail-head" },
      h("h3", {}, `Блок ${number}. ${block.title}`),
      button("quiet", { "data-key": `delete:${block.id}`, click: () => { actions.setDeleted(block.id, true) } }, "Удалить блок")),
    h("p", { class: "muted" }, block.takes.length === 1 ? "У этого блока один дубль." : "Дубли идут от лучшего к худшему. Отметьте тот, что пойдёт в монтаж."),
    h("ol", { class: "takes" }, ...block.takes.flatMap((take) => {
      const transcript = transcripts.get(take.video)
      return transcript === undefined ? [] : [takeItem(block, take, chosen, transcript, edits, actions)]
    })))

export const deletedList = (deleted: ReadonlyArray<Block>, actions: DetailActions): HTMLElement =>
  h("div", { class: "detail" },
    h("h3", {}, "Удалённые блоки"),
    h("ul", { class: "files" }, ...deleted.map((block) =>
      h("li", {}, h("span", {}, block.title),
        button("normal", {
          "data-key": `restore:${block.id}`,
          click: () => { actions.setDeleted(block.id, false) }
        }, ...spoken("Вернуть", `Вернуть блок «${block.title}»`))))))

const RULES = [`Пауза: молчание от ${formatPause(MIN_PAUSE)}`, `На месте паузы остаётся ${formatPause(PAUSE_REST)}`, "Звук на стыке: плавно"]

const pauseItem = (one: Placed, number: number, pause: Pause, wordAt: (video: string, index: number) => string, actions: DetailActions): HTMLElement => {
  const size = formatPause(pause.end - pause.start)
  const word = wordAt(one.take.video, pause.after)
  return h("li", { class: pause.removed ? "pause-row removed" : "pause-row" },
    h("span", { class: "where" },
      h("b", {}, size),
      h("span", {}, `блок ${number}, после «${word}»`)),
    h("div", { class: "take-acts" },
      button("normal", {
        title: "Полторы секунды до паузы и полторы после",
        "data-key": `hear-pause:${one.take.video}:${pause.after}`,
        click: () => { actions.hearPause(one, pause) }
      }, ...spoken("Послушать", `Послушать место паузы ${size} в блоке ${number}`)),
      button("normal", {
        "data-key": `list-pause:${one.take.video}:${pause.after}`,
        click: () => { actions.setPause(one.take.video, pause.after, !pause.removed) }
      }, ...spoken(pause.removed ? "Вернуть" : "Убрать", pause.removed ? `Вернуть паузу ${size} в блоке ${number}` : `Убрать паузу ${size} в блоке ${number}`))))
}

export const pauseList = (placed: ReadonlyArray<Placed>, wordAt: (video: string, index: number) => string, actions: DetailActions): HTMLElement => {
  const all = placed.flatMap((one, index) => one.pauses.map((pause) => ({ one, number: index + 1, pause })))
  const kept = all.filter(({ pause }) => !pause.removed).map(({ pause }) => pause)
  const count = all.length === 0
    ? "В выбранных дублях пауз нет."
    : `Убрано ${all.length - kept.length} из ${all.length}. Осталось пауз на ${formatLength(lengthOf(kept))}.`
  return h("div", { class: "detail" },
    h("p", { class: "did" }, "Студия нашла паузы в выбранных дублях. Уберите лишние по одной или все сразу кнопкой выше."),
    h("div", { class: "rules" }, ...RULES.map((rule) => h("span", {}, rule))),
    h("p", { class: "muted", role: "status" }, count),
    h("ol", { class: "pause-list" }, ...all.map(({ number, one, pause }) => pauseItem(one, number, pause, wordAt, actions))))
}
