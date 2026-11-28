import type { ZoomLevel } from "../../shared/zoom-plan.ts"
import type { ZoomPlace } from "../../shared/zooms.ts"
import { h } from "../dom.ts"
import { formatLength } from "../format.ts"
import type { Numbered } from "./montage-model.ts"
import { button } from "./ui.ts"

export interface ZoomActions {
  readonly setZoom: (id: string, level: ZoomLevel) => void
  readonly hearZoom: (place: ZoomPlace) => void
}

const ZOOM_NAMES = { off: "Нет", soft: "Мягкое", full: "Сильное" } satisfies Record<ZoomLevel, string>

const LEVELS = ["off", "soft", "full"] as const satisfies ReadonlyArray<ZoomLevel>

const factOf = (place: ZoomPlace): string => {
  const when = formatLength(place.at)
  if (place.state === "limited") return `${when} · кадр здесь уже приближен на склейке, сильнее нельзя`
  return place.given ? `${when} · выбрано вами` : `${when} · по правилу`
}

const zoomItem = ({ place }: Numbered<ZoomPlace>, words: string, actions: ZoomActions): HTMLElement => {
  const { id } = place.planned
  return h("li", { class: "pause" },
    h("span", { class: "pause__text" }, h("b", {}, `«${words}»`), h("br"), h("span", { class: "hint" }, factOf(place))),
    h("div", { class: "seg", role: "group", "aria-label": `Приближение на «${words}»` },
      ...LEVELS.map((level) => button(place.level === level ? "main" : "quiet", ZOOM_NAMES[level], {
        "aria-pressed": String(place.level === level),
        "data-key": `zoom:${level}:${id}`,
        click: () => { actions.setZoom(id, level) }
      }))),
    button("plain", "Смотреть", { "aria-label": `Смотреть приближение на «${words}»`, "data-key": `hear-zoom:${id}`, click: () => { actions.hearZoom(place) } }))
}

export const zoomGroup = (
  zooms: ReadonlyArray<Numbered<ZoomPlace>>,
  phraseOf: (phrase: ZoomPlace["planned"]) => string,
  actions: ZoomActions
): ReadonlyArray<HTMLElement> => zooms.length === 0 ? [] : [
  h("section", { class: "group" },
    h("h3", { class: "group__title" }, "Приближение"),
    h("p", { class: "hint" }, "Ключевые слова, на которых кадр медленно приближается к лицу. Выберите силу для каждого или уберите его."),
    h("ul", { class: "pauses" }, ...zooms.map((zoom) => zoomItem(zoom, phraseOf(zoom.place.planned).replace(/\p{P}+$/u, ""), actions))))
]
