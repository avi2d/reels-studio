import { Stream } from "effect"
import { ChildProcess } from "effect/process"
import { promptText } from "./attachment-notes.ts"
import type { Shown } from "./attachments.ts"
import type { Effort } from "./projects.ts"

export type Session = "person" | "studio"

const TOOLS = "read,grep,find,ls,write,edit"

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
  turnNote: string
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
    "--system-prompt", systemPrompt + "\nThe uploaded videos:\n" + known
  ], {
    cwd: dir,
    stdin: Stream.concat(Stream.make(new TextEncoder().encode(prompt + "\n")), Stream.never)
  })
}
