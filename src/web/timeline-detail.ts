import type { Transcript } from "../shared/plan.ts"
import { lengthOf } from "../shared/plan.ts"
import { pausesOf, playedSpans, type Block, type Edits, type Take } from "../shared/timeline.ts"
import { h } from "./dom.ts"
import { formatLength, formatPause } from "./format.ts"

export interface DetailActions {
  readonly choose: (block: string, take: Take) => void
  readonly hear: (block: string, take: Take) => void
  readonly hearAround: (block: string, take: Take) => void
  readonly playFrom: (block: string) => void
  readonly setDeleted: (block: string, deleted: boolean) => void
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
  return h("li", { class: "take" },
    h("label", { class: "choice" }, radio, h("span", {},
      h("span", { class: "name" }, rank === 1 ? "Лучший дубль" : `Дубль ${rank}`),
      h("span", {}, ...takeText(transcript, take, edits)),
      h("span", { class: "muted" }, take.reason),
      h("span", { class: "muted" }, facts.join(" · ")))),
    h("div", { class: "take-acts" },
      h("button", {
        type: "button",
        class: "secondary",
        "aria-label": `Послушать дубль ${rank}`,
        "data-key": `hear:${block.id}:${take.video}:${take.from}`,
        click: () => { actions.hear(block.id, take) }
      }, "Послушать"),
      h("button", {
        type: "button",
        class: "secondary",
        "aria-label": `Послушать дубль ${rank} с соседними блоками`,
        title: "Конец блока до него, этот дубль и начало блока после",
        "data-key": `around:${block.id}:${take.video}:${take.from}`,
        click: () => { actions.hearAround(block.id, take) }
      }, "С соседями")))
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
    h("h3", {}, `Блок ${number}. ${block.title}`),
    h("p", { class: "muted" }, block.takes.length === 1 ? "У этого блока один дубль." : "Дубли идут от лучшего к худшему. Отметьте тот, что пойдёт в монтаж."),
    h("ol", { class: "takes" }, ...block.takes.flatMap((take) => {
      const transcript = transcripts.get(take.video)
      return transcript === undefined ? [] : [takeItem(block, take, chosen, transcript, edits, actions)]
    })),
    h("div", { class: "row" },
      h("button", { type: "button", class: "secondary", "data-key": `from:${block.id}`, click: () => { actions.playFrom(block.id) } }, "Смотреть с этого блока"),
      h("button", { type: "button", class: "secondary", click: () => { actions.setDeleted(block.id, true) } }, "Удалить блок")))

export const deletedList = (deleted: ReadonlyArray<Block>, actions: DetailActions): HTMLElement =>
  h("div", { class: "detail" },
    h("h3", {}, "Удалённые блоки"),
    h("ul", { class: "files" }, ...deleted.map((block) =>
      h("li", {}, h("span", {}, block.title),
        h("button", {
          type: "button",
          class: "secondary",
          "aria-label": `Вернуть блок «${block.title}»`,
          "data-key": `restore:${block.id}`,
          click: () => { actions.setDeleted(block.id, false) }
        }, "Вернуть")))))
