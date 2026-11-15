import { judge } from "./guard-rules.ts"

interface ToolCall {
  readonly toolName: string
  readonly input: { readonly path?: unknown }
}

interface Host {
  readonly on: (
    event: "tool_call",
    handler: (call: ToolCall, context: { readonly cwd: string }) => { readonly block: true; readonly reason: string } | undefined
  ) => void
}

const SHARED = ["skills", "brands"].map((folder) => new URL(`../../${folder}`, import.meta.url).pathname)

// pi loads this file with -e and runs it on node, with the project folder as cwd
export default function projectGuard(pi: Host): void {
  pi.on("tool_call", (call, context) => {
    const target = typeof call.input.path === "string" ? call.input.path : undefined
    const verdict = judge({ project: context.cwd, readable: SHARED }, call.toolName, target)
    return verdict.allowed ? undefined : { block: true, reason: verdict.reason }
  })
}
