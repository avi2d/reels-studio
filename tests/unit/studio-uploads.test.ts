import { expect, spyOn, test } from "bun:test"
import { joiningTo, onTakesChanged, sendTakes, sendingTo } from "../../src/web/studio/uploads.ts"

test.each(["before", "after", "connected", "rejected"] as const)(
  "%s library lookup does not lose or duplicate a finished upload",
  async (connection) => {
    const id = `lookup-${connection}`
    const stored = new Map<string, string>()
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => { stored.set(key, value) },
        removeItem: (key: string) => { stored.delete(key) }
      }
    })
    let completed = false
    let disconnected = false
    let starts = 0
    let patches = 0
    let lookups = 0
    const added: Array<unknown> = []
    const states: Array<string> = []
    const finished = Promise.withResolvers<void>()
    const timer = setTimeout(() => { finished.reject(new Error("The upload did not settle")) }, 8000)
    const stop = onTakesChanged(() => {
      const entries = sendingTo(id)
      states.push(...entries.map((entry) => entry.take.kind))
      if (entries.some((entry) => entry.take.kind === "unsent") ||
        (added.length > 0 && entries.length === 0 && joiningTo(id).length === 0)) finished.resolve()
    })
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === "/api/library") {
        lookups += 1
        if (connection === "rejected") return Response.json({ error: "Library unavailable" }, { status: 503 })
        if (!disconnected && ((connection === "before" && !completed) || (connection === "after" && completed))) {
          disconnected = true
          throw new TypeError("Network disconnected")
        }
        return Response.json({ videos: completed ? [{ name: "take.mp4", size: 4, state: "ready", duration: 7 }] : [] })
      }
      if (url === "/api/library/uploads" && init?.method === "POST") {
        starts += 1
        return new Response(null, { status: 201, headers: { location: "/api/library/uploads/one" } })
      }
      if (url === "/api/library/uploads/one" && init?.method === "PATCH") {
        patches += 1
        completed = true
        return new Response(null, { status: 204, headers: { "upload-offset": "4" } })
      }
      if (url === `/api/projects/${id}/videos` && init?.method === "POST") {
        added.push(JSON.parse(String(init.body)))
        return Response.json({ project: {
          id, title: "Test reel", createdAt: "2026-01-01", stage: "uploaded", status: "uploaded",
          files: [{ name: "take.mp4", size: 4 }]
        } })
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    try {
      sendTakes(id, [new File(["take"], "take.mp4", { lastModified: 1 })])
      await finished.promise
      if (connection === "rejected") {
        expect(lookups).toBe(1)
        expect(starts).toBe(0)
        expect(states).toContain("unsent")
        expect(states).not.toContain("offline")
      } else {
        expect(sendingTo(id)).toEqual([])
        expect(joiningTo(id)).toEqual([])
        expect(starts).toBe(1)
        expect(patches).toBe(1)
        expect(added).toEqual([{ videos: [{ from: "library", name: "take.mp4" }] }])
        expect(states).not.toContain("unsent")
        if (connection !== "connected") expect(states).toContain("offline")
      }
    } finally {
      clearTimeout(timer)
      stop()
      fetch.mockRestore()
      if (previousStorage === undefined) Reflect.deleteProperty(globalThis, "localStorage")
      else Object.defineProperty(globalThis, "localStorage", previousStorage)
    }
  },
  10_000
)
