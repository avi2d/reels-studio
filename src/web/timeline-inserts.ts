import type { InsertPlace, Visual } from "../shared/inserts.ts"
import { h } from "./dom.ts"

export const visualName = (visual: Visual): string => visual.kind === "page" ? `${visual.file}, страница ${visual.page}` : visual.file

interface AnswerText {
  readonly label: string
  readonly does: string
}

export const KEEP: AnswerText = { label: "Оставить", does: "Вставка остаётся в ролике." }
export const KEEP_CLIP: AnswerText = { label: KEEP.label, does: "Вставка остаётся в ролике. Видео идёт без своего звука." }
export const SOUND: AnswerText = { label: "Со звуком", does: "Видео остаётся в ролике, и его звук слышен вместе с вашим голосом." }
export const REPLACE: AnswerText = { label: "Заменить", does: "На этом месте встанет другая картинка из тех, что вы прикрепили в чате." }
export const REMOVE: AnswerText = { label: "Убрать", does: "Ролик идёт без этой вставки." }

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

export const doneOf = (place: InsertPlace): string | undefined => {
  if (place.answer === "keep") return "остаётся"
  if (place.answer === "sound") return "остаётся со звуком"
  if (place.answer === "remove") return "убрана"
  if (place.answer === "replace") return `заменена на «${visualName(place.visual)}»`
  return undefined
}

export const canReplace = (place: InsertPlace, pictures: ReadonlyArray<string>): boolean =>
  pictures.some((picture) => place.visual.kind !== "picture" || place.visual.file !== picture)
