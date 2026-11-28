import { FRAME, ZONES, type Platform } from "../shared/zones.ts"

const across = (pixels: number): string => `${(pixels / FRAME.width * 100).toFixed(2)}%`
const down = (pixels: number): string => `${(pixels / FRAME.height * 100).toFixed(2)}%`

export const styleOf = (platform: Platform): string => {
  const { top, bottom, left, right, buttons } = ZONES[platform].bands
  const column = buttons ?? { left: FRAME.width - right, top }
  return `--top: ${down(top)}; --bottom: ${down(bottom)}; --left: ${across(left)}; --right: ${across(right)}; --buttons-left: ${across(column.left)}; --buttons-top: ${down(column.top)}`
}
