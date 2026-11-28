import { WEB_PAGE_TOOL } from "./guard-rules.ts"

interface Answer {
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>
  readonly details: Readonly<Record<string, never>>
}

interface Tool {
  readonly name: string
  readonly label: string
  readonly description: string
  readonly parameters: unknown
  readonly execute: (callId: string, params: { readonly address?: unknown }, signal: AbortSignal | undefined) => Promise<Answer>
}

interface Host {
  readonly registerTool: (tool: Tool) => void
}

const said = (text: string): Answer => ({ content: [{ type: "text", text }], details: {} })

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null

const textField = (value: unknown, key: string): string | undefined => {
  const field = isRecord(value) ? value[key] : undefined
  return typeof field === "string" ? field : undefined
}

const replyOf = (saved: unknown): string => {
  const file = textField(saved, "file")
  if (file === undefined) return "The studio did not save the page."
  const licence = textField(saved, "licence")
  return [
    `The studio saved the page as ${file} in attached/, from ${textField(saved, "address") ?? ""}.`,
    licence === undefined ? "The page names no licence." : `The page names its licence: ${licence}.`,
    textField(saved, "about") ?? ""
  ].join(" ")
}

// pi loads this file with -e and runs it on node; the studio passes its own address and the project in the environment.
export default function webPage(pi: Host): void {
  const studio = process.env["REELS_STUDIO_URL"]
  const project = process.env["REELS_PROJECT"]
  if (studio === undefined || project === undefined) return
  pi.registerTool({
    name: WEB_PAGE_TOOL,
    label: "Save a web page",
    description: "Open one web page by its address on the studio computer, save it as a PDF in attached/ with its address and licence, and read its text. Takes only an address, never a file.",
    parameters: {
      type: "object",
      properties: { address: { type: "string", description: "The full address of the page, starting with http:// or https://" } },
      required: ["address"],
      additionalProperties: false
    },
    execute: (_callId, params, signal) =>
      fetch(`${studio}/api/projects/${encodeURIComponent(project)}/web-pages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: typeof params.address === "string" ? params.address : "" }),
        ...signal === undefined ? {} : { signal }
      }).then((response) =>
        response.json().catch(() => undefined).then((answer: unknown) =>
          response.ok ? said(replyOf(answer)) : said(`The studio did not save the page: ${textField(answer, "error") ?? response.statusText}`)
        )
      )
  })
}
