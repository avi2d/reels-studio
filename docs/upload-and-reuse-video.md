---
kind: reference
---
# Upload, play, reuse and delete a video

The reel list at `/` lists the uploaded videos under «Загруженные записи», and its «Загрузить видео» button uploads any number of them.
A picked video whose cleaned name and size the library already lists is not uploaded again, unless the studio could not hear it.
A neutral notice names every skipped recording and points to the «Записи» step.
The reel list shows the videos uploaded since the page loaded at the top of page 1, above the older ones in name order, until the page reloads.
The uploaded videos go into one shared list in `projects/.library`, and the studio hears each of them there.
The «Записи» step of a reel only picks videos that are already uploaded.
Its list «Загружены раньше» offers the heard videos from that list and from other video folders: tick any number of them and press «Добавить в ролик».
The step lists the recordings of the reel, and pressing a word of a recording plays it from that word.
A picked video joins the folder at once with its text and preview, without a second upload or transcription.
The studio adds a hard link to the original and to the preview, so the bytes of a video stay on disk once.
It copies the two transcript files, which are small.
In «Загружены раньше» two uploads of one recording count as one video, matched by size and the SHA-256 of the first megabyte.

«Удалить запись» deletes the uploaded video after a confirm step: its original, preview, transcripts and gaze files leave `projects/.library`.
A reel that already picked the video keeps it, because the reel holds its own hard link and transcript copies.

Deleting a video folder first stops the chat turn and the transcription running for it, then removes the folder.
A video that another folder links to stays there, because removing one hard link leaves the others.
The studio never touches the files on the person's devices.
