import { button, setPressed } from "./controls.ts"
import { h } from "./dom.ts"

const STEP = 5
const ZOOM = 2

export const splitAt = (pointer: number, left: number, width: number): number =>
  width <= 0 ? 50 : Math.round(Math.min(100, Math.max(0, (pointer - left) / width * 100)))

export interface FaceCompare {
  readonly node: HTMLElement
  readonly show: (before: string, after: string) => void
}

export const faceCompare = (): FaceCompare => {
  const state = { split: 50, dragging: false }
  const after = h("img", { class: "compare-after", alt: "Лицо после пробы", width: "720", height: "720", draggable: "false" })
  const before = h("img", { class: "compare-before", alt: "Лицо до пробы", width: "720", height: "720", draggable: "false" })
  const frame = h("div", {
    class: "compare",
    role: "slider",
    tabindex: "0",
    "aria-label": "Граница между до и после",
    "aria-valuemin": "0",
    "aria-valuemax": "100"
  }, after, before, h("span", { class: "compare-line", "aria-hidden": "true" }),
  h("span", { class: "compare-tag compare-tag-before", "aria-hidden": "true" }, "До"),
  h("span", { class: "compare-tag compare-tag-after", "aria-hidden": "true" }, "После"))

  const place = (split: number): void => {
    state.split = split
    frame.style.setProperty("--split", `${split}%`)
    frame.setAttribute("aria-valuenow", String(split))
    frame.setAttribute("aria-valuetext", `Слева до: ${split}%`)
  }
  const follow = (event: PointerEvent): void => {
    const box = frame.getBoundingClientRect()
    place(splitAt(event.clientX, box.left, box.width))
  }
  frame.addEventListener("pointerdown", (event) => {
    state.dragging = true
    frame.setPointerCapture(event.pointerId)
    follow(event)
  })
  frame.addEventListener("pointermove", (event) => { if (state.dragging) follow(event) })
  const stop = (): void => { state.dragging = false }
  frame.addEventListener("pointerup", stop)
  frame.addEventListener("pointercancel", stop)
  frame.addEventListener("keydown", (event) => {
    const moves: Readonly<Record<string, number>> = { ArrowLeft: state.split - STEP, ArrowRight: state.split + STEP, Home: 0, End: 100 }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    place(Math.min(100, Math.max(0, next)))
  })

  const hold = (on: boolean): void => { frame.classList.toggle("holding", on) }
  const original = button("normal", { class: "compare-hold" }, "Держите, чтобы увидеть до")
  original.addEventListener("pointerdown", () => { hold(true) })
  for (const name of ["pointerup", "pointerleave", "pointercancel", "blur"]) original.addEventListener(name, () => { hold(false) })
  original.addEventListener("keydown", (event) => { if (event.key === " " || event.key === "Enter") hold(true) })
  original.addEventListener("keyup", () => { hold(false) })
  original.addEventListener("contextmenu", (event) => { event.preventDefault() })

  const zoom = button("normal", { "aria-pressed": "false" }, "Крупнее")
  zoom.addEventListener("click", () => {
    const on = !frame.classList.contains("zoomed")
    frame.classList.toggle("zoomed", on)
    frame.style.setProperty("--zoom", on ? String(ZOOM) : "1")
    setPressed(zoom, on)
    zoom.textContent = on ? "Всё лицо" : "Крупнее"
  })

  place(state.split)
  const node = h("div", { class: "compare-box" }, frame,
    h("p", { class: "muted" }, "Один кадр: слева до, справа после. Ведите границу пальцем или мышью."),
    h("div", { class: "row" }, original, zoom))
  const show = (beforeUrl: string, afterUrl: string): void => {
    before.src = beforeUrl
    after.src = afterUrl
  }
  return { node, show }
}
