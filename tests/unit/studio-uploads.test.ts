import { expect, spyOn, test } from "bun:test"
import { joiningTo, onTakesChanged, sendTakes, sendingTo } from "../../src/web/studio/uploads.ts"

type Connection = "before" | "after" | "connected" | "rejected"

const fakeStudio = (id: string, connection: Connection) => {
  const server = {
    completed: false,
    disconnected: false,
    starts: 0,
    patches: 0,
    lookups: 0,
    added: [] as Array<unknown>,
    handle: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
      const method = init?.method ?? "GET"
      if (url === "/api/library") return lookup()
      if (url === "/api/library/uploads" && method === "POST") return start()
      if (url === "/api/library/uploads/one" && method === "PATCH") return patch()
      if (url === `/api/projects/${id}/videos` && method === "POST") return add(init?.body)
      throw new Error(`Unexpected request: ${method} ${url}`)
    }
  }
  const dropsNow = () =>
    !server.disconnected &&
    ((connection === "before" && !server.completed) || (connection === "after" && server.completed))
  const lookup = () => {
    server.lookups += 1
    if (connection === "rejected") return Response.json({ error: "Library unavailable" }, { status: 503 })
    if (dropsNow()) {
      server.disconnected = true
      throw new TypeError("Network disconnected")
    }
    return Response.json({
      videos: server.completed ? [{ name: "take.mp4", size: 4, state: "ready", duration: 7 }] : []
    })
  }
  const start = () => {
    server.starts += 1
    return new Response(null, { status: 201, headers: { location: "/api/library/uploads/one" } })
  }
  const patch = () => {
    server.patches += 1
    server.completed = true
    return new Response(null, { status: 204, headers: { "upload-offset": "4" } })
  }
  const add = (body: BodyInit | null | undefined) => {
    if (typeof body !== "string") throw new Error("The request body is not JSON text")
    server.added.push(JSON.parse(body))
    return Response.json({ project: {
      id, title: "Test reel", createdAt: "2026-01-01", stage: "uploaded", status: "uploaded",
      files: [{ name: "take.mp4", size: 4 }]
    } })
  }
  return server
}

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
    const server = fakeStudio(id, connection)
    const added = server.added
    const states: Array<string> = []
    const finished = Promise.withResolvers<void>()
    const timer = setTimeout(() => { finished.reject(new Error("The upload did not settle")) }, 8000)
    const stop = onTakesChanged(() => {
      const entries = sendingTo(id)
      states.push(...entries.map((entry) => entry.take.kind))
      if (entries.some((entry) => entry.take.kind === "unsent") ||
        (added.length > 0 && entries.length === 0 && joiningTo(id).length === 0)) finished.resolve()
    })
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => server.handle(input, init))
    try {
      sendTakes(id, [new File(["take"], "take.mp4", { lastModified: 1 })])
      await finished.promise
      if (connection === "rejected") {
        expect(server.lookups).toBe(1)
        expect(server.starts).toBe(0)
        expect(states).toContain("unsent")
        expect(states).not.toContain("offline")
      } else {
        expect(sendingTo(id)).toEqual([])
        expect(joiningTo(id)).toEqual([])
        expect(server.starts).toBe(1)
        expect(server.patches).toBe(1)
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
