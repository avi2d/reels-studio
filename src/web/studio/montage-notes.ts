import { h } from "../dom.ts"
import type { Loaded } from "../timeline-load.ts"
import { button } from "./ui.ts"

const status = (text: string): HTMLElement => h("p", { class: "hint", role: "status" }, text)

const readyNotes = ({ view }: Loaded): ReadonlyArray<HTMLElement> => {
  const { inserts, texts, timeline } = view
  return [
    ...view.gathering ? [status("Студия собирает части заново. Дубли и паузы обновятся сами.")] : [],
    ...timeline.state === "ready" && timeline.dropped > 0 ? [h("p", { class: "hint" }, `Студия пропустила дубли, которых не нашла в записях: ${timeline.dropped}. Попросите в чате собрать части заново.`)] : [],
    ...inserts.state === "unreadable" ? [h("p", { class: "error" }, "Вставки не прочитались. Попросите в чате предложить их заново.")] : [],
    ...inserts.state === "ready" && inserts.dropped > 0 ? [h("p", { class: "hint" }, `Студия пропустила вставки, для которых не нашла файл, страницу документа или фразу: ${inserts.dropped}. Попросите в чате предложить их заново.`)] : [],
    ...texts.state === "unreadable" ? [h("p", { class: "error" }, "Ключевые мысли не прочитались, поэтому в ролике их нет. Попросите в чате написать их заново.")] : []
  ]
}

export const notesOf = (loaded: Loaded, gather: () => void): ReadonlyArray<HTMLElement> => {
  const { transcripts, view } = loaded
  const { timeline } = view
  if (transcripts.size === 0) return [status("Части появятся, когда студия услышит первую запись.")]
  if (view.gathering && timeline.state !== "ready") return [status("Студия собирает части из записей. Потом сама выберет лучший дубль в каждой части и сократит паузы.")]
  const gatherButton = (label: string): HTMLElement => button("main", label, { class: "btn btn--main btn--start", click: gather })
  if (timeline.state === "unreadable") return [h("p", { class: "error" }, "Части не прочитались. Попросите студию собрать их заново."), gatherButton("Собрать части заново")]
  if (timeline.state === "none") {
    return [
      view.gatherFailed ? h("p", { class: "error" }, "Студия не смогла собрать части. Новая запись попробует ещё раз сама.") : h("p", { class: "hint" }, "Частей пока нет. Студия соберёт их из текста всех записей: дубли с одним смыслом попадут в одну часть, лучший дубль встанет первым."),
      gatherButton("Собрать части")
    ]
  }
  return readyNotes(loaded)
}
