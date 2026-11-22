export const PLATFORMS = ["Instagram", "Instagram, реклама", "YouTube Shorts", "TikTok"] as const
export type Platform = (typeof PLATFORMS)[number]

export const FRAME = { width: 1080, height: 1920 } as const

export interface Bands {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
  readonly buttons: { readonly width: number; readonly from: number }
}

export type Source =
  | { readonly kind: "published"; readonly name: string }
  | { readonly kind: "measured"; readonly name: string }
  | { readonly kind: "unconfirmed" }

// Shares of the frame in percent. The button column runs from `buttons.from` of the height down to the bottom band.
export const ZONES = {
  Instagram: { source: { kind: "measured", name: "Instagram web player, 22 November 2026, and Azalia's reference reels" }, bands: { top: 6, bottom: 12, left: 6, right: 6, buttons: { width: 13, from: 55 } } },
  "Instagram, реклама": { source: { kind: "published", name: "Meta Business Help, text overlays and the Safe Zone, Reels ads" }, bands: { top: 14, bottom: 35, left: 6, right: 6, buttons: { width: 21, from: 60 } } },
  "YouTube Shorts": { source: { kind: "unconfirmed" }, bands: { top: 10, bottom: 20, left: 6, right: 6, buttons: { width: 12, from: 10 } } },
  TikTok: { source: { kind: "unconfirmed" }, bands: { top: 10, bottom: 20, left: 6, right: 6, buttons: { width: 15, from: 10 } } }
} as const satisfies Readonly<Record<Platform, { readonly source: Source; readonly bands: Bands }>>

export interface Rect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface TextArea {
  readonly box: Rect
  readonly buttons: Rect
}

export const textAreaOf = (platform: Platform): TextArea => {
  const { top, bottom, left, right, buttons } = ZONES[platform].bands
  const x = (share: number): number => Math.round(FRAME.width * share / 100)
  const y = (share: number): number => Math.round(FRAME.height * share / 100)
  const box = { left: x(left), top: y(top), right: FRAME.width - x(right), bottom: FRAME.height - y(bottom) }
  return { box, buttons: { left: FRAME.width - x(buttons.width), top: y(buttons.from), right: FRAME.width, bottom: box.bottom } }
}

const overlaps = (one: Rect, other: Rect): boolean =>
  one.left < other.right && other.left < one.right && one.top < other.bottom && other.top < one.bottom

export const fitsArea = (ink: Rect, area: TextArea): boolean =>
  ink.left >= area.box.left && ink.right <= area.box.right && ink.top >= area.box.top && ink.bottom <= area.box.bottom && !overlaps(ink, area.buttons)
