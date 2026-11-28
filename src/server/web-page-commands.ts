import { BlockList, isIP } from "node:net"
import { isHomeAddress } from "./home-network.ts"

const LONGEST_ADDRESS = 2000
const LONGEST_LICENCE = 200

export const checkedAddress = (address: string): URL | undefined => {
  const trimmed = address.trim()
  if (trimmed.length > LONGEST_ADDRESS || !URL.canParse(trimmed)) return undefined
  const url = new URL(trimmed)
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
  if (url.username !== "" || url.password !== "" || url.hostname === "") return undefined
  url.hash = ""
  return url
}

const unroutable = new BlockList()
unroutable.addSubnet("0.0.0.0", 8, "ipv4")
unroutable.addAddress("::", "ipv6")
unroutable.addSubnet("64:ff9b::", 96, "ipv6")
unroutable.addSubnet("64:ff9b:1::", 48, "ipv6")

export const isOutside = (address: string): boolean =>
  isIP(address) !== 0 && !isHomeAddress(address) && !unroutable.check(address, isIP(address) === 6 ? "ipv6" : "ipv4")

export const pageName = (url: URL, digest: string): string =>
  `web-${url.hostname.toLowerCase().replace(/^www\./u, "").replace(/[^a-z0-9.-]/gu, "-")}-${digest.slice(0, 10)}.pdf`

// Chrome upgrades an http address to https and refuses the load when the site answers only over http, as an official law site can.
export const browserArgs = (profile: string): ReadonlyArray<string> => [
  "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
  `--user-data-dir=${profile}`, "--remote-debugging-pipe", "--no-startup-window",
  "--disable-background-networking", "--disable-quic", "--disable-extensions", "--block-new-web-contents",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable,HttpsFirstModeV2ForTypicallySecureUsers"
]

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", nbsp: " ", copy: "©" }

const decoded = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16))
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)))
    return ENTITIES[name.toLowerCase()] ?? whole
  })

const plain = (html: string): string => decoded(html.replace(/<[^>]*>/gu, " ")).replace(/\s+/gu, " ").trim()

const attributesOf = (tag: string): ReadonlyMap<string, string> =>
  new Map([...tag.matchAll(/([a-z:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/giu)].map((match) =>
    [(match[1] ?? "").toLowerCase(), decoded(match[2] ?? match[3] ?? match[4] ?? "").trim()]))

const RIGHTS_NAMES = new Set(["license", "dc.rights", "dcterms.rights", "dcterms.license", "dc.license", "copyright"])

const isLicenceRel = (attributes: ReadonlyMap<string, string>): boolean =>
  (attributes.get("rel") ?? "").toLowerCase().split(/\s+/u).includes("license")

const licenceIn = (html: string): string | undefined => {
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const attributes = attributesOf(match[1] ?? "")
    if (!isLicenceRel(attributes)) continue
    const text = plain(match[2] ?? "")
    return text === "" ? attributes.get("href") : text
  }
  for (const match of html.matchAll(/<(link|meta)\b[^>]*>/giu)) {
    const attributes = attributesOf(match[0])
    if (match[1]?.toLowerCase() === "link" && isLicenceRel(attributes)) return attributes.get("href")
    if (RIGHTS_NAMES.has((attributes.get("name") ?? attributes.get("property") ?? "").toLowerCase())) return attributes.get("content")
  }
  return undefined
}

export const licenceOf = (html: string): string | undefined => {
  const found = licenceIn(html)?.trim()
  return found === undefined || found === "" ? undefined : found.slice(0, LONGEST_LICENCE)
}
