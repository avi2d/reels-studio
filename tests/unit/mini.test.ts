import { expect, test } from "bun:test"
import { shrinkWhenScrolledPast } from "../../src/web/mini.ts"

test("tapping the mini player expands it before scrolling to avoid a bar at the top", () => {
  const originalObserver = globalThis.IntersectionObserver
  let report: IntersectionObserverCallback = () => {}
  let click = (): void => {}
  const classes = new Set<string>()
  let miniAtScroll = false
  const viewer = Object.assign(Object.create(null), {
    isConnected: true,
    offsetHeight: 500,
    style: { minHeight: "" },
    classList: {
      contains: (name: string) => classes.has(name),
      toggle: (name: string, enabled: boolean) => enabled ? classes.add(name) : classes.delete(name),
      remove: (name: string) => classes.delete(name)
    },
    querySelector: () => ({ addEventListener: (_name: string, listener: () => void) => { click = listener } }),
    scrollIntoView: () => { miniAtScroll = classes.has("mini") }
  })
  class Observer {
    constructor(callback: IntersectionObserverCallback) { report = callback }
    observe(): void {}
    disconnect(): void {}
  }
  Object.assign(globalThis, { IntersectionObserver: Observer })
  try {
    shrinkWhenScrolledPast(viewer)
    report([Object.assign(Object.create(null), { isIntersecting: false, boundingClientRect: { top: -1 } })], Object.create(null))
    expect(classes.has("mini")).toBe(true)
    click()
    expect(miniAtScroll).toBe(false)
    expect(classes.has("mini")).toBe(false)
    expect(viewer.style.minHeight).toBe("")
  } finally {
    Object.assign(globalThis, { IntersectionObserver: originalObserver })
  }
})
