export const PLATFORMS = ["Instagram", "Instagram, реклама", "YouTube Shorts", "YouTube Shorts, реклама", "TikTok", "TikTok, реклама"] as const
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
// On a phone taller than 9 by 16 the players fill the screen and cut the frame's sides, so the side bands are the cut.
export const ZONES = {
  Instagram: { source: { kind: "measured", name: "Instagram's App Store screenshot of Reels on an iPhone, 1284 by 2778" }, bands: { top: 200, bottom: 410, left: 100, right: 100, buttons: { left: 865, top: 980 } } },
  "Instagram, реклама": { source: { kind: "published", name: "Meta Business Help, About text overlays and the Safe Zone, Reels ads" }, bands: { top: 269, bottom: 672, left: 65, right: 65, buttons: { left: 853, top: 1152 } } },
  "YouTube Shorts": { source: { kind: "measured", name: "YouTube's App Store screenshot of Shorts on an iPhone, 1284 by 2778" }, bands: { top: 185, bottom: 200, left: 55, right: 55, buttons: { left: 910, top: 1095 } } },
  "YouTube Shorts, реклама": { source: { kind: "published", name: "Google Ads Help, Use square and vertical video to engage mobile customers, Safe zones for vertical video ads on YouTube" }, bands: { top: 288, bottom: 672, left: 48, right: 192, buttons: undefined } },
  TikTok: { source: { kind: "measured", name: "TikTok's App Store screenshots of For You on an iPhone, 1242 by 2688" }, bands: { top: 200, bottom: 260, left: 45, right: 45, buttons: { left: 880, top: 790 } } },
  "TikTok, реклама": { source: { kind: "published", name: "TikTok Ads Manager, TikTok Auction In-Feed Ads, In-Feed Standard safe zone file" }, bands: { top: 240, bottom: 660, left: 120, right: 120, buttons: { left: 780, top: 840 } } }
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
