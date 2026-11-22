import { LOUDNESS_TARGET, SERIES_STEP, SILENCE_LUFS, type Jump, type Series } from "../shared/reel.ts"
import { formatLength } from "./format.ts"

const WIDTH = 600
const HEIGHT = 200
const LEFT = 40
const RIGHT = 8
const TOP = 10
const BOTTOM = 24
const LOUDEST = -6
const QUIETEST = -60
const SVG_NS = "http://www.w3.org/2000/svg"
const PLOT_WIDTH = WIDTH - LEFT - RIGHT
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM

const minus = (value: number): string => String(value).replace("-", "\u2212")

const element = (tag: string, attrs: Readonly<Record<string, string>>, text?: string): Element => {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value)
  if (text !== undefined) node.textContent = text
  return node
}

export const loudnessChart = (series: Series, jumps: ReadonlyArray<Jump>, seconds: number, label: string): Element => {
  const x = (time: number): number => LEFT + (time / seconds) * PLOT_WIDTH
  const y = (lufs: number): number => TOP + ((LOUDEST - Math.min(Math.max(lufs, QUIETEST), LOUDEST)) / (LOUDEST - QUIETEST)) * PLOT_HEIGHT
  const line = (values: ReadonlyArray<number>, className: string): Element => {
    let d = ""
    let pen = false
    values.forEach((lufs, index) => {
      if (lufs <= SILENCE_LUFS) {
        pen = false
        return
      }
      d += `${pen ? "L" : "M"}${x(index * SERIES_STEP).toFixed(1)} ${y(lufs).toFixed(1)}`
      pen = true
    })
    return element("path", { class: className, d })
  }
  const targetY = y(LOUDNESS_TARGET).toFixed(1)
  const root = element("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: "img", "aria-label": label })
  root.append(
    ...jumps.map((jump) => element("rect", {
      class: "jump",
      x: x(jump.from).toFixed(1),
      y: String(TOP),
      width: Math.max(1, x(jump.to) - x(jump.from)).toFixed(1),
      height: String(PLOT_HEIGHT)
    })),
    line(series.before, "line-before"),
    line(series.after, "line-after"),
    element("line", { class: "target", x1: String(LEFT), x2: String(WIDTH - RIGHT), y1: targetY, y2: targetY }),
    element("text", { class: "axis", x: String(WIDTH - RIGHT), y: String(Number(targetY) - 4), "text-anchor": "end" }, `цель ${minus(LOUDNESS_TARGET)}`),
    ...[-20, -40].map((tick) => element("text", { class: "axis", x: String(LEFT - 6), y: String(y(tick) + 4), "text-anchor": "end" }, minus(tick))),
    element("text", { class: "axis", x: String(LEFT), y: String(HEIGHT - 6) }, "0:00"),
    element("text", { class: "axis", x: String(WIDTH - RIGHT), y: String(HEIGHT - 6), "text-anchor": "end" }, formatLength(seconds))
  )
  return root
}
