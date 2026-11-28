import { BlockList, isIP } from "node:net"
import os from "node:os"

const home = new BlockList()
for (const [address, prefix] of [
  ["10.0.0.0", 8], ["127.0.0.0", 8], ["172.16.0.0", 12],
  ["192.168.0.0", 16], ["169.254.0.0", 16]
] as const) home.addSubnet(address, prefix, "ipv4")
home.addAddress("::1", "ipv6")
home.addSubnet("fc00::", 7, "ipv6")
home.addSubnet("fe80::", 10, "ipv6")

export const isHomeAddress = (address: string): boolean =>
  home.check(address, isIP(address) === 6 ? "ipv6" : "ipv4")

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
  return allowed.has(host.toLowerCase()) || /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.localhost(?::[0-9]{1,5})?$/i.test(host)
}
