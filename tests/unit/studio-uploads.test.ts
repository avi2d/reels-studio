import { expect, spyOn, test } from "bun:test"
import type { UploadedVideo } from "../../src/shared/library.ts"
import { onTakesChanged, sendingNow, sendTakes, type TakesChange } from "../../src/web/studio/uploads.ts"

type Connection = "connected" | "dropped" | "rejected"

const fakeStudio = (connection: Connection, listed: ReadonlyArray<UploadedVideo> = []) => {
  const server = {
    completed: false,
    disconnected: false,
    starts: 0,
    patches: 0,
    lookups: 0,
    handle: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
      const method = init?.method ?? "GET"
      if (url === "/api/library") return lookup()
      if (url === "/api/library/uploads" && method === "POST") return start()
      if (url === "/api/library/uploads/one" && method === "PATCH") return patch()
      throw new Error(`Unexpected request: ${method} ${url}`)
    }
  }
  const lookup = () => {
    server.lookups += 1
    if (connection === "rejected") return Response.json({ error: "Library unavailable" }, { status: 503 })
    if (connection === "dropped" && server.completed && !server.disconnected) {
      server.disconnected = true
      throw new TypeError("Network disconnected")
    }
    return Response.json({ videos: [...listed, ...(server.completed ? [{ name: "take.mp4", size: 4, state: "waiting" }] : [])] })
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
  return server
}

const withLocalStorage = async (body: () => Promise<void>): Promise<void> => {
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
  try {
    await body()
  } finally {
    if (previousStorage === undefined) Reflect.deleteProperty(globalThis, "localStorage")
    else Object.defineProperty(globalThis, "localStorage", previousStorage)
  }
}

test.each([
  ["connected", []],
  ["dropped", []],
  ["rejected", []],
  ["connected", [{ name: "take.mp4", size: 4, state: "failed" }]]
] satisfies ReadonlyArray<[Connection, ReadonlyArray<UploadedVideo>]>)(
  "a pick with lookup %s and library %j uploads rather than blocking a failed take, then leaves the queue once",
  async (connection, listed) => {
    await withLocalStorage(async () => {
      const server = fakeStudio(connection, listed)
      const states: Array<string> = []
      const ends: Array<TakesChange> = []
      const finished = Promise.withResolvers<void>()
      const timer = setTimeout(() => { finished.reject(new Error("The upload did not settle")) }, 8000)
      const stop = onTakesChanged((change) => {
        states.push(...sendingNow().map((entry) => entry.take.kind))
        if (change.kind !== "moved") ends.push(change)
        if (change.kind !== "moved" || states.includes("unsent")) finished.resolve()
      })
      const fetch = spyOn(globalThis, "fetch").mockImplementation(
        Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => server.handle(input, init), { preconnect: () => {} })
      )
      try {
        sendTakes([new File(["take"], "take.mp4", { lastModified: 1 })])
        await finished.promise
        expect(sendingNow()).toEqual([])
        expect(server.starts).toBe(1)
        expect(server.patches).toBe(1)
        expect(states).not.toContain("unsent")
        if (connection === "rejected") expect(ends).toEqual([{ kind: "unlisted" }])
        else expect(ends).toEqual([{ kind: "listed", uploaded: [...listed, { name: "take.mp4", size: 4, state: "waiting" }] }])
        if (connection === "dropped") expect(states).toContain("offline")
      } finally {
        clearTimeout(timer)
        stop()
        fetch.mockRestore()
      }
    })
  },
  10_000
)

test.each([
  ["take.mp4", "take.mp4"],
  ["take:one.mp4", "takeone.mp4"],
  ["take.mp4 ", "take.mp4"],
  [".take.mp4", "take.mp4"],
  ["a<>:\"|?*\u0001b.mp4", "ab.mp4"],
  ["x".repeat(201) + ".mp4", "x".repeat(200)],
  ["...", "video"]
])(
  "a picked %s listed as %s is not uploaded again under a numbered name",
  async (picked, stored) => {
    await withLocalStorage(async () => {
      const server = fakeStudio("connected", [{ name: stored, size: 4, state: "ready", duration: 12 }])
      const ends: Array<TakesChange> = []
      const finished = Promise.withResolvers<void>()
      const timer = setTimeout(() => { finished.reject(new Error("The pick did not settle")) }, 8000)
      const stop = onTakesChanged((change) => {
        if (change.kind === "moved") return
        ends.push(change)
        finished.resolve()
      })
      const fetch = spyOn(globalThis, "fetch").mockImplementation(
        Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => server.handle(input, init), { preconnect: () => {} })
      )
      try {
        sendTakes([new File(["take"], picked, { lastModified: 1 })])
        await finished.promise
        expect(sendingNow()).toEqual([])
        expect(ends).toEqual([{ kind: "known", name: stored }])
        expect(server.starts).toBe(0)
        expect(server.patches).toBe(0)
      } finally {
        clearTimeout(timer)
        stop()
        fetch.mockRestore()
      }
    })
  },
  10_000
)
