import { Stream } from "effect"
import { ChildProcess } from "effect/process"
import { promptText } from "./attachment-notes.ts"
import type { Shown } from "./attachments.ts"
import type { Effort } from "./projects.ts"

import { WEB_PAGE_TOOL } from "../pi/guard-rules.ts"

export type Session = "person" | "studio"

const TOOLS = `read,grep,find,ls,write,edit,${WEB_PAGE_TOOL}`

export interface Reach {
  readonly studio: string
  readonly project: string
}

const ANY_ADDRESS = new Set(["0.0.0.0", "::", ""])

export const studioUrl = (host: string, port: number): string => {
  const local = ANY_ADDRESS.has(host) ? "127.0.0.1" : host
  return `http://${local.includes(":") ? `[${local}]` : local}:${port}`
}

export const piCommand = (
  pi: string,
  root: string,
  join: (...parts: Array<string>) => string,
  systemPrompt: string,
  dir: string,
  text: string,
  files: ReadonlyArray<Shown>,
  model: string,
  effort: Effort,
  known: string,
  asker: Session,
  turnNote: string,
  reach: Reach
): ReturnType<typeof ChildProcess.make> => {
  const images = files.flatMap((file) => file.images)
  // In the message rather than the system prompt, so the note stands after the earlier replies it overrides.
  const message = turnNote === "" ? promptText(text, files) : `${promptText(text, files)}\n\n${turnNote}`
  const prompt = JSON.stringify({ id: "prompt", type: "prompt", message, ...(images.length === 0 ? {} : { images }) })
  return ChildProcess.make(pi, [
    "--mode", "rpc",
    "--model", model,
    "--thinking", effort,
    "--session-dir", join(dir, asker === "studio" ? "gather" : "chat"),
    "--continue",
    "--tools", TOOLS,
    "--no-approve",
    "--no-mcp",
    "--no-skills",
    "--skill", join(root, "skills"),
    "--no-context-files",
    "--no-prompt-templates",
    "--extension", join(root, "src", "pi", "project-guard.ts"),
    "--extension", join(root, "src", "pi", "web-page.ts"),
    "--system-prompt", systemPrompt + "\nThe uploaded videos:\n" + known
  ], {
    cwd: dir,
    env: { REELS_STUDIO_URL: reach.studio, REELS_PROJECT: reach.project },
    extendEnv: true,
    stdin: Stream.concat(Stream.make(new TextEncoder().encode(prompt + "\n")), Stream.never)
  })
}
