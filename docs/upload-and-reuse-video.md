---
kind: reference
---
# Upload a video, reuse it and delete a video folder

The person uploads videos only on the main page, with the «Загрузить видео» button next to «Новый ролик».
The uploaded videos go into one shared list in `projects/.library`, and the studio hears each of them there.
Inside a reel, the «Выбрать видео» button of the «Видео» card offers the heard videos from that list and from other video folders.
A picked video joins the folder at once with its text and preview, without a second upload or transcription.
The studio adds a hard link to the original and to the preview, so the bytes of a video stay on disk once.
It copies the two transcript files, which are small.
In «Выбрать видео» two uploads of one recording count as one video, matched by size and the SHA-256 of the first megabyte.

Deleting a video folder first stops the chat turn and the transcription running for it, then removes the folder.
A video that another folder links to stays there, because removing one hard link leaves the others.
The studio never touches the files on the person's devices.
