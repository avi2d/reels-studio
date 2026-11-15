import os from "node:os"

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i

const isHomeV4 = (address: string): boolean => {
  const match = V4.exec(address)
  if (match === null) return false
  const [first, second] = [Number(match[1]), Number(match[2])]
  if (match.slice(1).some((part) => Number(part) > 255)) return false
  if (first === 10 || first === 127) return true
  if (first === 172) return second >= 16 && second <= 31
  if (first === 192) return second === 168
  return first === 169 && second === 254
}

const isHomeV6 = (address: string): boolean => {
  const lower = address.toLowerCase()
  if (lower === "::1") return true
  return /^f[cd][0-9a-f]{2}:/.test(lower) || /^fe[89ab][0-9a-f]:/.test(lower)
}

export const isHomeAddress = (address: string): boolean => {
  const mapped = MAPPED.exec(address)
  if (mapped !== null) return isHomeV4(mapped[1] ?? "")
  return isHomeV4(address) || isHomeV6(address)
}

export const isSameOrigin = (origin: string | undefined, host: string | undefined): boolean => {
  if (origin === undefined) return true
  if (host === undefined || !URL.canParse(origin)) return false
  return new URL(origin).host === host
}

export const allowedHosts = (port: number): ReadonlySet<string> => {
  const hosts = new Set<string>([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`])
  for (const group of Object.values(os.networkInterfaces())) {
    for (const entry of group ?? []) {
      const address = entry.address.split("%")[0] ?? ""
      if (!isHomeAddress(address)) continue
      hosts.add(entry.family === "IPv6" ? `[${address}]:${port}` : `${address.toLowerCase()}:${port}`)
    }
  }
  const short = os.hostname().toLowerCase().split(".")[0] ?? ""
  if (short !== "") hosts.add(`${short}.local:${port}`)
  return hosts
}

export const isAllowedHost = (host: string | undefined, allowed: ReadonlySet<string>): boolean => {
  if (host === undefined) return false
  return allowed.has(host.toLowerCase())
}
