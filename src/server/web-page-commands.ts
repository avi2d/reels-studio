import { isHomeAddress } from "./home-network.ts"

const LONGEST_ADDRESS = 2000
const LOAD_MS = 20000
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

const UNSPECIFIED = /^(?:0\.\d{1,3}\.\d{1,3}\.\d{1,3}|::|::ffff:0\.\d{1,3}\.\d{1,3}\.\d{1,3})$/iu

// A page on the home network, such as the router or the studio itself, is never sent to the chat model.
export const isOutside = (address: string): boolean => !isHomeAddress(address) && !UNSPECIFIED.test(address)

export const pageName = (url: URL, digest: string): string =>
  `web-${url.hostname.toLowerCase().replace(/^www\./u, "").replace(/[^a-z0-9.-]/gu, "-")}-${digest.slice(0, 10)}.pdf`

// Chrome upgrades an http address to https and refuses the load when the site answers only over http, as an official law site can.
const chromeArgs = (profile: string): ReadonlyArray<string> => [
  "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
  `--user-data-dir=${profile}`, `--timeout=${LOAD_MS}`,
  "--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable,HttpsFirstModeV2ForTypicallySecureUsers"
]

export const printArgs = (address: string, profile: string, output: string): ReadonlyArray<string> =>
  [...chromeArgs(profile), "--no-pdf-header-footer", `--print-to-pdf=${output}`, address]

export const domArgs = (address: string, profile: string): ReadonlyArray<string> =>
  [...chromeArgs(profile), "--dump-dom", address]

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
