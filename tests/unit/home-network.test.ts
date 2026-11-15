import { expect, test } from "bun:test"
import { allowedHosts, isAllowedHost, isHomeAddress, isSameOrigin } from "../../src/server/home-network.ts"

test("a public address is refused, not treated as home", () => {
  expect(isHomeAddress("8.8.8.8")).toBe(false)
  expect(isHomeAddress("2001:4860:4860::8888")).toBe(false)
})

test("the RFC 1918 block 172.16/12 ends at 172.31, so 172.32 is not home", () => {
  expect(isHomeAddress("172.16.0.1")).toBe(true)
  expect(isHomeAddress("172.31.255.254")).toBe(true)
  expect(isHomeAddress("172.32.0.1")).toBe(false)
  expect(isHomeAddress("172.15.0.1")).toBe(false)
})

test("192.168/16 and 10/8 are home, 192.169 and 11 are not", () => {
  expect(isHomeAddress("192.168.1.62")).toBe(true)
  expect(isHomeAddress("10.0.0.7")).toBe(true)
  expect(isHomeAddress("192.169.1.1")).toBe(false)
  expect(isHomeAddress("11.0.0.1")).toBe(false)
})

test("an IPv4-mapped IPv6 address is judged by its IPv4 part, not passed as IPv6", () => {
  expect(isHomeAddress("::ffff:192.168.1.5")).toBe(true)
  expect(isHomeAddress("::ffff:8.8.8.8")).toBe(false)
})

test("loopback, unique local fc00::/7 and link-local fe80::/10 are home", () => {
  expect(isHomeAddress("127.0.0.1")).toBe(true)
  expect(isHomeAddress("::1")).toBe(true)
  expect(isHomeAddress("fd12:3456::1")).toBe(true)
  expect(isHomeAddress("fe80::1")).toBe(true)
})

test("an octet above 255 is not an address, even with a home prefix", () => {
  expect(isHomeAddress("10.0.0.256")).toBe(false)
})

test("a rebound host is refused while the loopback allow list passes", () => {
  const allowed = new Set(["localhost:8765", "127.0.0.1:8765", "[::1]:8765", "192.168.1.62:8765", "winbox.local:8765"])
  expect(isAllowedHost("attacker.example:8765", allowed)).toBe(false)
  expect(isAllowedHost("192.168.1.62:8765", allowed)).toBe(true)
  expect(isAllowedHost("localhost:8765", allowed)).toBe(true)
  expect(isAllowedHost("192.168.1.62:9999", allowed)).toBe(false)
  expect(isAllowedHost(undefined, allowed)).toBe(false)
})

test("the allow list always carries loopback with the studio port", () => {
  const allowed = allowedHosts(8765)
  expect(allowed.has("localhost:8765")).toBe(true)
  expect(allowed.has("127.0.0.1:8765")).toBe(true)
})

test("a request from another site's page is refused, not let through by a matching path", () => {
  expect(isSameOrigin("http://evil.example", "192.168.1.62:8765")).toBe(false)
  expect(isSameOrigin("http://192.168.1.62:8765", "192.168.1.62:8765")).toBe(true)
  expect(isSameOrigin(undefined, "192.168.1.62:8765")).toBe(true)
  expect(isSameOrigin("null", "192.168.1.62:8765")).toBe(false)
})
