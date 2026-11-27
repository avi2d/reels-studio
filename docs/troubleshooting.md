---
kind: how-to
---
# Troubleshooting

## The page does not open from a phone

Windows blocks inbound connections to WSL by default.
The page opens on the computer itself and not from another device until the owner adds a Hyper-V firewall rule for the port.

## A video shows «Студия не расслышала это видео»

ffmpeg or the recognizer failed, and the studio log holds what it printed.
Run `journalctl --user -u reels-studio.service` to read the log.
Press «Попробовать ещё раз» under the video to have the studio listen to it again.
A video with no sound fails again.

## The chat answers «Ответ не дошёл»

pi or the model provider refused the message, and the studio log holds what each printed.
Run `pi --list-models` and check that the chosen model is in the list.
