import { Context, Deferred, Effect, Layer, Ref } from "effect"

interface Flight {
  readonly stop: Deferred.Deferred<void>
  readonly finished: Deferred.Deferred<void>
}

export class GatherState extends Context.Service<GatherState, {
  readonly running: (id: string) => Effect.Effect<boolean>
  readonly track: <A, E, R>(id: string, task: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly settled: (id: string) => Effect.Effect<void>
  readonly trackAlone: <A, E, R>(id: string, task: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly blocked: (id: string) => Effect.Effect<boolean>
  readonly withoutGather: <A, E, R>(id: string, use: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}>()("reels-studio/GatherState") {
  static readonly layer = Layer.effect(
    GatherState,
    Effect.gen(function*() {
      const current = yield* Ref.make<{ readonly id: string; readonly flight: Flight } | undefined>(undefined)
      const closed = yield* Ref.make<ReadonlySet<string>>(new Set())
      const alone = yield* Ref.make<ReadonlyMap<string, ReadonlyArray<Flight>>>(new Map())

      const running = (id: string): Effect.Effect<boolean> =>
        Effect.map(Ref.get(current), (held) => held?.id === id)

      const track = <A, E, R>(id: string, task: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        Effect.acquireUseRelease(
          Effect.gen(function*() {
            const flight: Flight = { stop: yield* Deferred.make<void>(), finished: yield* Deferred.make<void>() }
            yield* Ref.set(current, { id, flight })
            return flight
          }),
          (flight) => Effect.raceFirst(task, Deferred.await(flight.stop)),
          (flight) => Effect.gen(function*() {
            yield* Ref.set(current, undefined)
            yield* Deferred.succeed(flight.finished, undefined)
          })
        )

      const settled = (id: string): Effect.Effect<void> =>
        Effect.gen(function*() {
          const held = yield* Ref.get(current)
          if (held?.id !== id) return
          yield* Deferred.await(held.flight.finished)
        })

      const trackAlone = <A, E, R>(id: string, task: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        Effect.acquireUseRelease(
          Effect.gen(function*() {
            const flight: Flight = { stop: yield* Deferred.make<void>(), finished: yield* Deferred.make<void>() }
            yield* Ref.update(alone, (map) => {
              const next = new Map(map)
              next.set(id, [...(next.get(id) ?? []), flight])
              return next
            })
            return flight
          }),
          (flight) => Effect.raceFirst(task, Deferred.await(flight.stop)),
          (flight) => Effect.gen(function*() {
            yield* Ref.update(alone, (map) => {
              const flights = (map.get(id) ?? []).filter((held) => held !== flight)
              const next = new Map(map)
              if (flights.length === 0) next.delete(id)
              else next.set(id, flights)
              return next
            })
            yield* Deferred.succeed(flight.finished, undefined)
          })
        )

      const blocked = (id: string): Effect.Effect<boolean> =>
        Effect.map(Ref.get(closed), (set) => set.has(id))

      const withoutGather = <A, E, R>(id: string, use: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        Effect.acquireUseRelease(
          Effect.gen(function*() {
            yield* Ref.update(closed, (set) => new Set([...set, id]))
            const held = yield* Ref.get(current)
            if (held?.id === id) {
              yield* Deferred.succeed(held.flight.stop, undefined)
              yield* Deferred.await(held.flight.finished)
            }
            const flights = (yield* Ref.get(alone)).get(id) ?? []
            yield* Effect.forEach(flights, (flight) => Deferred.succeed(flight.stop, undefined), { discard: true })
            yield* Effect.forEach(flights, (flight) => Deferred.await(flight.finished))
          }),
          () => use,
          () => Ref.update(closed, (set) => new Set([...set].filter((other) => other !== id)))
        )

      return GatherState.of({ running, track, settled, trackAlone, blocked, withoutGather })
    })
  )
}
