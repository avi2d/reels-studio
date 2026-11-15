# reels-studio

Reels studio is a web page served from a home computer, where a person prepares vertical videos for Instagram.
The person uploads a video, writes in a chat in plain words, and the studio answers with a plan before it changes anything.
This first step holds the page, the chat, the upload and three skills.
It does not transcribe, cut or render a video yet.

## Before you begin

- Bun, at the version `.bun-version` pins.
- pi, the agent the chat runs on, signed in to at least one model provider.
- A computer on the home network that keeps running while the studio is in use.

## Install

To install reels-studio:

1. Clone the repository.
1. Run `bun install --frozen-lockfile`.

## Start the studio

To start the studio:

1. Run `bun run start`.
1. Open `http://<address of the computer>:8765` in a browser on the same Wi-Fi.

The log prints `Listening on http://0.0.0.0:8765`.
The page shows the list of videos and a form that creates the first one.

The studio answers only addresses of a private network and has no password.
Do not forward its port to the internet.

## Change the settings

Each setting is an environment variable read at start.

| Variable | Default | What it sets |
| --- | --- | --- |
| `REELS_PORT` | `8765` | The port the studio listens on |
| `REELS_HOST` | `0.0.0.0` | The address the studio listens on |
| `REELS_PROJECTS_DIR` | `projects` | The folder that holds one folder per video |
| `REELS_PI` | `pi` | The pi command the chat starts |
| `REELS_MODELS` | Claude Opus 5.5, Claude Sonnet 5.5 and GPT 6.1 Sol | The models the page offers, separated by commas, each as `provider/model` |

## Run the checks

To run the checks:

1. Run `bun run test` to run the tests.
1. Run `bun run lint` to run the linter and the kit gates.
1. Run `bun run typecheck` to check the types and the Effect diagnostics.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/index.ts` | The entry that starts the server |
| `src/server/` | The routes, the video folders, the resumable upload and the chat |
| `src/pi/` | The pi extension that keeps the chat model inside one video folder |
| `src/web/` | The page, its styles and its script |
| `skills/` | The three skills the chat model reads: plan, style and player zones |
| `brands/` | One folder per style profile with its colours, fonts and templates |
| `prompts/studio.md` | The system prompt of the chat model |
| `projects/` | One folder per video with the original, the chat and the plan, kept out of git |
| `tests/unit/` | The unit tests |

## Troubleshooting

### The page does not open from a phone

Windows blocks inbound connections to WSL by default.
The page opens on the computer itself and not from another device until the owner adds a Hyper-V firewall rule for the port.

### The chat answers «Ответ не дошёл»

pi or the model provider refused the message, and the studio log holds what each printed.
Run `pi --list-models` and check that the chosen model is in the list.
