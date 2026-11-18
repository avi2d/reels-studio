# reels-studio

Reels studio is a web page served from a home computer, where a person prepares vertical videos for Instagram.
The person uploads a video, writes in a chat in plain words, and the studio answers with a plan before it changes anything.
The studio writes down every word of an uploaded video with its time, and the chat model reads that text.
The page shows the text with the planned removals struck through, and its player skips them.
It does not cut, caption, crop, restyle or publish a video yet.

## Before you begin

- Bun, at the version `.bun-version` pins.
- pi, the agent the chat runs on, signed in to at least one model provider.
- ffmpeg and ffprobe, built with the `zscale` and `tonemap` filters, which turn iPhone HDR video into ordinary colours.
- uv, which installs and runs the speech recognizer in `tools/transcribe/` and the gaze measure in `tools/gaze/`.
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
| `REELS_HEAVY` | empty | A command, split at spaces, that the studio puts before each ffmpeg and recognizer run, such as a queue for heavy work |
| `REELS_ENCODER` | `libx264` | The ffmpeg video encoder, such as `h264_nvenc` on a computer with an NVIDIA card |

## Keep the studio running

The owner's computer serves the studio from a clone of `main` at `~/Projects/reels-studio`.
The uploaded videos and everything made from them live in `~/.local/share/reels-studio/projects`, outside any clone.

To make the studio start again after a restart of the computer:

1. Copy `deploy/reels-studio.service` to `~/.config/systemd/user/`.
1. Run `systemctl --user daemon-reload`.
1. Run `loginctl enable-linger $USER`.
1. Run `systemctl --user enable --now reels-studio.service`.

The linger step keeps the user manager running without an open login.
On WSL2, open the Linux machine once after each Windows restart.
Without that step, systemd finds no machine for the unit.

To serve a newer `main`:

1. Run `git pull` and `bun install --frozen-lockfile` in `~/Projects/reels-studio`.
1. Run `systemctl --user restart reels-studio.service`.

How the studio hears a video lives in [How the studio hears a video](docs/how-the-studio-hears-a-video.md).

## Reuse a video and delete a video folder

The «Видео» card offers the videos the studio has already heard in other video folders.
A picked video joins the folder at once with its text and preview, without a second upload or transcription.
The studio adds a hard link to the original and to the preview, so the bytes of a video stay on disk once.
It copies the two transcript files, which are small.
Two uploads of one recording count as one video, matched by size and the SHA-256 of the first megabyte.

Deleting a video folder first stops the chat turn and the transcription running for it, then removes the folder.
A video that another folder links to stays there, because removing one hard link leaves the others.
The studio never touches the files on the person's devices.

## Run the checks

To run the checks:

1. Run `bun run test` to run the tests.
1. Run `bun run lint` to run the linter and the kit gates.
1. Run `bun run typecheck` to check the types and the Effect diagnostics.

The project layout lives in [Project layout](docs/project-layout.md).
The row of blocks and takes is described in [Takes and blocks](docs/timeline.md).

## Troubleshooting

### The page does not open from a phone

Windows blocks inbound connections to WSL by default.
The page opens on the computer itself and not from another device until the owner adds a Hyper-V firewall rule for the port.

### A video shows «Студия не расслышала это видео»

ffmpeg or the recognizer failed, and the studio log holds what it printed.
Run `journalctl --user -u reels-studio.service` to read the log.
Press «Попробовать ещё раз» under the video to have the studio listen to it again.
A video with no sound fails again.

### The chat answers «Ответ не дошёл»

pi or the model provider refused the message, and the studio log holds what each printed.
Run `pi --list-models` and check that the chosen model is in the list.
