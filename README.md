# reels-studio

Reels studio is a web page served from a home computer, where a person prepares vertical videos for Instagram.
The person uploads a video, writes in a chat in plain words, and the studio answers with a plan before it changes anything.
The studio writes down every word of an uploaded video with its time, and the chat model reads that text.
The page shows the text with the planned removals struck through, and its player skips them.
The studio builds the chosen takes into one 1080 by 1920 file to watch and download.
It brings the skin colour of the later videos to the first.
The person can attach pictures, screenshots, PDF files, video and sound to a chat message, and the studio says what each holds.
The chat model runs at its provider in the cloud, so the attached files and the pictures and text taken from them are sent there.
It draws one-word subtitles and the key thoughts of the plan on the reel.
It does not publish a video.

## Before you begin

- Bun, at the version `.bun-version` pins.
- pi, the agent the chat runs on, signed in to at least one model provider.
- ffmpeg and ffprobe, built with the `zscale` and `tonemap` filters for HDR video, the `afftdn` filter for room noise, and libass with the `ass` and `bbox` filters for text.
- uv, which installs and runs the speech recognizer in `tools/transcribe/`, the gaze measure in `tools/gaze/` and the PDF reader in `tools/pdf/`.
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
The page shows the videos as tiles with covers and a button that starts the next one.
The new screens open at `/new` beside the old page.
Each reel card shows its status, and the reel's top bar menu lets you rename it.
The reel list at `/new` shows reels and uploaded takes five to a page, uploads takes and resumes an interrupted upload.
Step 1, «Записи», adds the uploaded takes you tick to the reel at once and plays a recording from a word you press.
Step 2, «План», saves the task with its apps and files, shows the plan and takes the yes, and the chat on every step streams its reply and has «Остановить».
Step 3, «Монтаж», lists the parts of the reel with their takes, pauses, words, texts and inserts.
Its «Вопросы» button walks through every doubtful word, join and insert still waiting for an answer, and «Отменить» undoes any change on the step.
The rules, now the length of a pause, show as «Правила» on the step they belong to, change from a chat sentence and carry to the next reels with a pin, as [Takes and blocks](docs/timeline.md) says.
On step 4, «Оформление», play the reel and switch between the three «Шум» choices to hear the room noise change.
The studio uses your choice when it builds the reel and leaves the original recording alone.

The studio answers the home network and the owner's Mac through the `local-apps` gateway.
The gateway must listen only on that Mac's loopback address.
The studio has no public address or password.
Do not forward the studio or gateway port to the internet.

## Share a demo

On the computer running the demo:

1. Start the demo on a free port and note the server process ID.
1. Run `local-apps register <name> --port <port> --pid <server pid>`.
1. Give the owner the printed address and the path to the demo.

## Change the settings

Each setting is an environment variable read at start.

| Variable | Default | What it sets |
| --- | --- | --- |
| `REELS_PORT` | `8765` | The port the studio listens on |
| `REELS_HOST` | `0.0.0.0` | The address the studio listens on |
| `REELS_PROJECTS_DIR` | `projects` | The folder that holds one folder per video |
| `REELS_PI` | `pi` | The pi command the chat starts |
| `REELS_MODELS` | Claude Opus 5.5, Claude Sonnet 5.5 and GPT 6.1 Sol | The models the page offers, separated by commas, each as `provider/model` |
| `REELS_HEAVY` | empty | A command, split at spaces, that the studio puts before each ffmpeg, speech recognizer, gaze and PDF run, such as a queue for heavy work |
| `REELS_ENCODER` | `libx264` | The ffmpeg video encoder, such as `h264_nvenc` on a computer with an NVIDIA card |

## Keep the studio running

The steps that keep the studio running and serve a newer `main` are in [Keep the studio running](docs/keep-the-studio-running.md).

How the studio hears a video lives in [How the studio hears a video](docs/how-the-studio-hears-a-video.md).

Upload, play, reuse and delete a video lives in [Upload, play, reuse and delete a video](docs/upload-and-reuse-video.md).

## Run the checks

To run the checks:

1. Run `bun run test` to run the tests.
1. Run `bun run lint` to run the linter and the kit gates.
1. Run `bun run typecheck` to check the types and the Effect diagnostics.

On pull requests, GitHub Actions selects unit tests, end-to-end tests, and browser routes by changed path.
Changes to shared test settings run the whole tier.
A push to `main` or a release runs all three tiers and the PDF image comparison.
The suite in [tests/e2e/browser/](tests/e2e/browser/) runs only in GitHub Actions and needs no model account.

The project layout lives in [Project layout](docs/project-layout.md).
The row of blocks and takes is described in [Takes and blocks](docs/timeline.md).
The brief, the plan and the yes are described in [The brief and the one plan](docs/brief.md).
What to do when the page does not open, a video is not heard or the chat does not answer is in [Troubleshooting](docs/troubleshooting.md).
