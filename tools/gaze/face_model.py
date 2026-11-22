import hashlib
import os
import urllib.request
from pathlib import Path

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
MODEL_SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"


def model_path() -> Path:
    cache = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "reels-studio"
    target = cache / "face_landmarker.task"
    if not target.exists():
        cache.mkdir(parents=True, exist_ok=True)
        part = target.with_suffix(".part")
        urllib.request.urlretrieve(MODEL_URL, part)
        if hashlib.sha256(part.read_bytes()).hexdigest() != MODEL_SHA256:
            part.unlink()
            raise SystemExit("The face model file does not match its checksum.")
        part.rename(target)
    return target
