import { expect, test } from "bun:test"
import { faceLeft, framedHead, frameToward, inView, VIEW_WIDTH } from "../../src/shared/framing.ts"

const middle = VIEW_WIDTH / 2

test("a head lower after the join is enlarged until the eyes sit on the earlier line, not left where it fell", () => {
  const target = { x: middle, y: 0.4, size: 0.2 }
  const frame = frameToward(target, { x: middle, y: 0.45, size: 0.2 })
  expect(frame?.scale).toBeCloseTo(0.6 / 0.55, 6)
  expect(frame?.top).toBeCloseTo(0.45 - 0.4 * 0.55 / 0.6, 6)
  expect(framedHead({ x: middle, y: 0.45, size: 0.2 }, frame).y).toBeCloseTo(0.4, 6)
})

test("a jump that needs more than a slight zoom gets no frame instead of a blurred picture", () => {
  expect(frameToward({ x: middle, y: 0.4, size: 0.2 }, { x: middle, y: 0.5, size: 0.2 })).toBeUndefined()
})

test("a frame never reaches past the picture edge, so no black band shows", () => {
  const frame = frameToward({ x: 0.1, y: 0.4, size: 0.2 }, { x: 0.12, y: 0.42, size: 0.2 })
  expect(frame).toBeDefined()
  if (frame === undefined) return
  expect(frame.left).toBeGreaterThanOrEqual(0)
  expect(frame.top).toBeGreaterThanOrEqual(0)
  expect(frame.left + VIEW_WIDTH / frame.scale).toBeLessThanOrEqual(VIEW_WIDTH + 1e-9)
  expect(frame.top + 1 / frame.scale).toBeLessThanOrEqual(1 + 1e-9)
})

test("a face off centre in a horizontal source sits in the middle of the window, not at the window edge", () => {
  expect(faceLeft([{ x: 1.4, y: 0.4, size: 0.2 }], 16 / 9)).toBeCloseTo(1208.25 / 1080, 9)
})

test("a face at the left edge of the source leaves the window at the picture's left edge, not before it", () => {
  expect(faceLeft([{ x: 0.1, y: 0.4, size: 0.2 }], 16 / 9)).toBe(0)
})

test("a face at the right edge of the source leaves the window at the picture's right edge, not past it", () => {
  expect(faceLeft([{ x: 1.77, y: 0.4, size: 0.2 }], 16 / 9)).toBeCloseTo(16 / 9 - VIEW_WIDTH, 9)
})

test("one stray detection far from the face does not move the window, so the median decides, not the mean", () => {
  const heads = [1.4, 1.4, 1.4, 0.2].map((x) => ({ x, y: 0.4, size: 0.2 }))
  expect(faceLeft(heads, 16 / 9)).toBeCloseTo(1208.25 / 1080, 9)
})

test("no face found, or a source no wider than the window, has no face window and stays in the middle", () => {
  expect(faceLeft(undefined, 16 / 9)).toBeUndefined()
  expect(faceLeft([null, null], 16 / 9)).toBeUndefined()
  expect(faceLeft([{ x: 0.3, y: 0.4, size: 0.2 }], 9 / 16)).toBeUndefined()
})

test("with no face window the head keeps the position the middle crop gave it", () => {
  expect(inView({ x: 1.4, y: 0.4, size: 0.2 }, 16 / 9, undefined).x).toBeCloseTo(1.4 - (16 / 9 - VIEW_WIDTH) / 2, 9)
})
