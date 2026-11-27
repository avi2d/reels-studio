---
kind: how-to
---
# Troubleshooting

Three faults stop the studio.
The page may not open from a phone, a video may not be heard and the chat may not answer.

## The page does not open from a phone

Windows blocks inbound connections to WSL by default.
The page opens on the computer itself and not from another device until the owner adds a Hyper-V firewall rule for the port.

To open the page from a phone:

1. Add a Hyper-V firewall rule for the studio port on the Windows computer.
1. Open the page again from the phone.

## A video shows «Студия не расслышала это видео»

ffmpeg or the recognizer failed, and the studio log holds what it printed.
A video with no sound fails again.

To have the studio listen to the video again:

1. Run `journalctl --user -u reels-studio.service` to read the log.
1. Press «Попробовать ещё раз» under the video.

## The chat answers «Ответ не дошёл»

pi or the model provider refused the message, and the studio log holds what each printed.

To check the chosen model:

1. Run `pi --list-models`.
1. Check that the chosen model is in the list.
