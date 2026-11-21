---
kind: reference
---
# Upload, play, reuse and delete a video

The «Загрузить видео» link next to «Новый ролик» on the main page opens the «Загруженные видео» page at `#/videos`.
That page shows each uploaded video as a card with its first frame, name, length and size, and its «Загрузить видео» button is the only place that uploads a video.
The play button on a card plays the video in place in the browser's player.
The uploaded videos go into one shared list in `projects/.library`, and the studio hears each of them there.
Inside a reel, the «Выбрать видео» button of the «Видео» card offers the heard videos from that list and from other video folders.
A picked video joins the folder at once with its text and preview, without a second upload or transcription.
The studio adds a hard link to the original and to the preview, so the bytes of a video stay on disk once.
It copies the two transcript files, which are small.
In «Выбрать видео» two uploads of one recording count as one video, matched by size and the SHA-256 of the first megabyte.

The cross on a card deletes the uploaded video after a confirm step: its original, preview, transcripts and gaze files leave `projects/.library`.
A reel that already picked the video keeps it, because the reel holds its own hard link and transcript copies.

Deleting a video folder first stops the chat turn and the transcription running for it, then removes the folder.
A video that another folder links to stays there, because removing one hard link leaves the others.
The studio never touches the files on the person's devices.
