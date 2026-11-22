import { expect, test } from "bun:test"
import { framedHead, frameToward, VIEW_WIDTH } from "../../src/shared/framing.ts"

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
