export const PLATFORMS = ["Instagram", "Instagram, реклама", "YouTube Shorts", "TikTok"] as const
export type Platform = (typeof PLATFORMS)[number]

export const FRAME = { width: 1080, height: 1920 } as const

interface Column {
  readonly left: number
  readonly top: number
}

export interface Bands {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
  readonly buttons: Column | undefined
}

export type Source =
  | { readonly kind: "published"; readonly name: string }
  | { readonly kind: "measured"; readonly name: string }
  | { readonly kind: "unconfirmed" }

// Pixels of the 1080 by 1920 frame. The button column runs from its corner to the right edge and down to the bottom band.
export const ZONES = {
  Instagram: { source: { kind: "measured", name: "Instagram web player, 22 November 2026, and Azalia's reference reels" }, bands: { top: 115, bottom: 230, left: 65, right: 65, buttons: { left: 940, top: 1056 } } },
  "Instagram, реклама": { source: { kind: "published", name: "Meta Business Help, About text overlays and the Safe Zone, Reels ads" }, bands: { top: 269, bottom: 672, left: 65, right: 65, buttons: { left: 853, top: 1152 } } },
  "YouTube Shorts": { source: { kind: "published", name: "Google Ads Help, Use square and vertical video to engage mobile customers, Safe zones for vertical video ads on YouTube" }, bands: { top: 288, bottom: 672, left: 48, right: 192, buttons: undefined } },
  TikTok: { source: { kind: "published", name: "TikTok Ads Manager, TikTok Auction In-Feed Ads, In-Feed Standard safe zone file" }, bands: { top: 240, bottom: 660, left: 120, right: 120, buttons: { left: 780, top: 840 } } }
} as const satisfies Readonly<Record<Platform, { readonly source: Source; readonly bands: Bands }>>

export interface Rect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface TextArea {
  readonly box: Rect
  readonly buttons: Rect | undefined
}

export const textAreaOf = (platform: Platform): TextArea => {
  const { top, bottom, left, right, buttons } = ZONES[platform].bands
  const box = { left, top, right: FRAME.width - right, bottom: FRAME.height - bottom }
  return { box, buttons: buttons === undefined ? undefined : { left: buttons.left, top: buttons.top, right: box.right, bottom: box.bottom } }
}

const overlaps = (one: Rect, other: Rect): boolean =>
  one.left < other.right && other.left < one.right && one.top < other.bottom && other.top < one.bottom

export const fitsArea = (ink: Rect, area: TextArea): boolean =>
  ink.left >= area.box.left && ink.right <= area.box.right && ink.top >= area.box.top && ink.bottom <= area.box.bottom && (area.buttons === undefined || !overlaps(ink, area.buttons))
