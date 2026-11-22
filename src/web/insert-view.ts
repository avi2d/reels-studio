import { shapeOf, type InsertLook } from "../shared/inserts.ts"
import { h } from "./dom.ts"

export interface InsertView {
  readonly node: HTMLElement
  readonly paint: (look: InsertLook | undefined) => void
}

export const insertView = (pictureUrl: (picture: string) => string): InsertView => {
  const image = h("img", { alt: "" })
  const node = h("div", { class: "insert-view", hidden: true, "aria-hidden": "true" }, h("div", { class: "insert-box" }, h("div", { class: "insert-card" }, image)))
  const state: { picture: string | undefined } = { picture: undefined }
  image.addEventListener("load", () => {
    node.dataset.shape = shapeOf(image.naturalWidth, image.naturalHeight)
    if (image.naturalHeight > 0) node.style.setProperty("--ar", String(image.naturalWidth / image.naturalHeight))
  })
  const paint = (look: InsertLook | undefined): void => {
    node.hidden = look === undefined
    if (look === undefined) return
    if (look.picture !== state.picture) {
      state.picture = look.picture
      delete node.dataset.shape
      image.src = pictureUrl(look.picture)
    }
    node.style.opacity = look.opacity.toFixed(3)
    image.style.transform = `scale(${look.scale.toFixed(4)})`
  }
  return { node, paint }
}
