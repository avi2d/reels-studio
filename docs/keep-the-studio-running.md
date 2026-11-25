---
kind: how-to
---
# Keep the studio running

The owner's computer serves the studio from a clone of `main` at `~/Projects/reels-studio`.
The uploaded videos and everything made from them live in `~/.local/share/reels-studio/projects`, outside any clone.

## Start the studio again after a restart

To make the studio start again after a restart of the computer:

1. Copy `deploy/reels-studio.service` to `~/.config/systemd/user/`.
1. Run `systemctl --user daemon-reload`.
1. Run `loginctl enable-linger $USER`.
1. Run `systemctl --user enable --now reels-studio.service`.

The linger step keeps the user manager running without an open login.
On WSL2, open the Linux machine once after each Windows restart.
Without that step, systemd finds no machine for the unit.

## Serve a newer main

To serve a newer `main`:

1. Run `git pull` and `bun install --frozen-lockfile` in `~/Projects/reels-studio`.
1. Run `systemctl --user restart reels-studio.service`.
