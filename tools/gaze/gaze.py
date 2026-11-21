import argparse
import hashlib
import json
import math
import os
import sys
import urllib.request
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python as tasks
from mediapipe.tasks.python import vision

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
MODEL_SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"
SAMPLES_PER_SECOND = 5
EYE_TURN_DEGREES = 27
CAMERA_WITHIN_DEGREES = 12
IRIS_CENTRES = (468, 473)
BROW_TOP = 10
CHIN = 152


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


def look_of(face) -> str:
    if not face.face_blendshapes:
        return "hidden"
    eye = {shape.category_name: shape.score for shape in face.face_blendshapes[0]}
    head = face.facial_transformation_matrixes[0]
    right = ((eye["eyeLookOutLeft"] - eye["eyeLookInLeft"]) + (eye["eyeLookInRight"] - eye["eyeLookOutRight"])) / 2
    down = ((eye["eyeLookDownLeft"] + eye["eyeLookDownRight"]) - (eye["eyeLookUpLeft"] + eye["eyeLookUpRight"])) / 2
    gaze_right = math.degrees(math.atan2(head[0][2], head[2][2])) + EYE_TURN_DEGREES * right
    gaze_down = math.degrees(math.asin(-head[1][2])) + EYE_TURN_DEGREES * down
    # The head is rarely on the lens axis, so the look into the lens is measured from where the head is.
    lens_right = math.degrees(math.atan2(-head[0][3], -head[2][3]))
    lens_down = math.degrees(math.atan2(head[1][3], -head[2][3]))
    off = math.hypot(gaze_right - lens_right, gaze_down - lens_down)
    return "camera" if off <= CAMERA_WITHIN_DEGREES else "away"


def head_of(face, aspect: float) -> dict[str, float] | None:
    if not face.face_landmarks:
        return None
    points = face.face_landmarks[0]
    # Landmarks come as shares of the frame width and height, and a share of the height is the one unit both axes share.
    eyes = [points[index] for index in IRIS_CENTRES]
    x = sum(point.x for point in eyes) / len(eyes) * aspect
    y = sum(point.y for point in eyes) / len(eyes)
    size = math.hypot((points[BROW_TOP].x - points[CHIN].x) * aspect, points[BROW_TOP].y - points[CHIN].y)
    return {"x": round(x, 4), "y": round(y, 4), "size": round(size, 4)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument("output")
    args = parser.parse_args()

    options = vision.FaceLandmarkerOptions(
        base_options=tasks.BaseOptions(model_asset_path=str(model_path())),
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True,
        num_faces=1,
    )
    landmarker = vision.FaceLandmarker.create_from_options(options)
    video = cv2.VideoCapture(args.video)
    rate = video.get(cv2.CAP_PROP_FPS)
    if not video.isOpened() or rate <= 0:
        print("The video cannot be read.", file=sys.stderr)
        raise SystemExit(65)
    every = max(1, round(rate / SAMPLES_PER_SECOND))
    aspect = video.get(cv2.CAP_PROP_FRAME_WIDTH) / video.get(cv2.CAP_PROP_FRAME_HEIGHT)
    samples: list[str] = []
    heads: list[dict[str, float] | None] = []
    number = 0
    while video.grab():
        if number % every == 0:
            read, frame = video.retrieve()
            if not read:
                break
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            face = landmarker.detect(image)
            samples.append(look_of(face))
            heads.append(head_of(face, aspect))
        number += 1
    result = {"step": every / rate, "samples": samples, "heads": heads}
    Path(args.output).write_text(json.dumps(result), encoding="utf-8")


main()
