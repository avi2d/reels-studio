import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as tasks
from mediapipe.tasks.python import vision

from face_model import model_path

RATE = 30
WIDTH = 1080
HEIGHT = 1920
FACE_OVAL = (10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109)
EYES = (
    (33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246),
    (362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398),
)
IRISES = ((468, (469, 470, 471, 472)), (473, (474, 475, 476, 477)))
BROWS = (
    (70, 63, 105, 66, 107, 55, 65, 52, 53, 46),
    (300, 293, 334, 296, 336, 285, 295, 282, 283, 276),
)
LIPS = (61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185)
BROW_TOP = 10
CHIN = 152
# Shares of the face height, from the brow top to the chin.
FINE_DETAIL = 0.004
BLOTCH = 0.03
FEATHER = 0.02
# Tone steps in 0-255 above which a difference is the face's shape and not a blotch.
SHAPE_STEP = 14.0
SKIN_STRENGTH = 0.6
WHITE_LIFT = 0.3
WHITE_RED_CUT = 0.5
SCLERA_FROM = 90.0
SCLERA_TO = 150.0
STEADY = 0.5
# The broad blur and the mask are made on a picture this many times smaller, since both are smooth.
COARSE = 4


def polygon(points: np.ndarray, indices) -> np.ndarray:
    return np.round(points[list(indices)]).astype(np.int32)


def shrunk(image: np.ndarray) -> np.ndarray:
    return cv2.resize(image, None, fx=1 / COARSE, fy=1 / COARSE, interpolation=cv2.INTER_AREA)


def grown(image: np.ndarray, shape) -> np.ndarray:
    return cv2.resize(image, (shape[1], shape[0]), interpolation=cv2.INTER_LINEAR)


def skin_mask(shape, points: np.ndarray, face: float) -> np.ndarray:
    small = (shape[0] // COARSE + 1, shape[1] // COARSE + 1)
    scaled = points / COARSE
    mask = np.zeros(small, np.uint8)
    cv2.fillPoly(mask, [polygon(scaled, FACE_OVAL)], 255)
    holes = np.zeros(small, np.uint8)
    for part in (*EYES, *BROWS, LIPS):
        cv2.fillPoly(holes, [polygon(scaled, part)], 255)
    grow = max(1, round(face * 0.03 / COARSE))
    holes = cv2.dilate(holes, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1, 2 * grow + 1)))
    mask = cv2.GaussianBlur(cv2.subtract(mask, holes), (0, 0), face * FEATHER / COARSE)
    return grown(mask.astype(np.float32) / 255, shape)


def white_mask(shape, points: np.ndarray, face: float) -> np.ndarray:
    mask = np.zeros(shape, np.uint8)
    for eye in EYES:
        cv2.fillPoly(mask, [polygon(points, eye)], 255)
    shrink = max(1, round(face * 0.004))
    mask = cv2.erode(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * shrink + 1, 2 * shrink + 1)))
    for centre, ring in IRISES:
        middle = points[centre]
        radius = float(np.mean(np.linalg.norm(points[list(ring)] - middle, axis=1))) * 1.15
        cv2.circle(mask, (round(middle[0]), round(middle[1])), max(1, round(radius)), 0, -1)
    return cv2.GaussianBlur(mask, (0, 0), max(0.8, face * 0.003)).astype(np.float32) / 255


def even_skin(image: np.ndarray, mask: np.ndarray, face: float) -> np.ndarray:
    fine = cv2.GaussianBlur(image, (0, 0), max(0.6, face * FINE_DETAIL))
    broad = grown(cv2.GaussianBlur(shrunk(image), (0, 0), face * BLOTCH / COARSE), image.shape)
    blotch = fine - broad
    # A blotch is a small tone step, and a large one is a nose side or a cheekbone the face keeps.
    size = np.max(np.abs(blotch), axis=2, keepdims=True)
    keep_shape = np.exp(-np.square(size / SHAPE_STEP))
    return image - blotch * keep_shape * (mask[..., None] * SKIN_STRENGTH)


def lighten_whites(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(np.clip(image, 0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB).astype(np.float32)
    light = lab[..., 0]
    sclera = np.clip((light - SCLERA_FROM) / (SCLERA_TO - SCLERA_FROM), 0, 1) * mask
    lab[..., 0] = light + (255 - light) * WHITE_LIFT * sclera
    lab[..., 1] = 128 + (lab[..., 1] - 128) * (1 - WHITE_RED_CUT * sclera)
    lab[..., 2] = 128 + (lab[..., 2] - 128) * (1 - WHITE_RED_CUT * sclera)
    done = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR).astype(np.float32)
    weight = sclera[..., None]
    return image * (1 - weight) + done * weight


def area_of(points: np.ndarray, indices, margin: float, shape) -> tuple[int, int, int, int]:
    chosen = points[list(indices)]
    left = max(0, int(chosen[:, 0].min() - margin))
    top = max(0, int(chosen[:, 1].min() - margin))
    right = min(shape[1], int(chosen[:, 0].max() + margin) + 1)
    bottom = min(shape[0], int(chosen[:, 1].max() + margin) + 1)
    return left, top, right, bottom


def retouch(frame: np.ndarray, points: np.ndarray) -> np.ndarray:
    face = float(np.linalg.norm(points[BROW_TOP] - points[CHIN]))
    done = frame.copy()
    left, top, right, bottom = area_of(points, FACE_OVAL, face * 0.1, frame.shape)
    part = frame[top:bottom, left:right].astype(np.float32)
    part = even_skin(part, skin_mask(part.shape[:2], points - (left, top), face), face)
    done[top:bottom, left:right] = np.clip(part + 0.5, 0, 255).astype(np.uint8)
    left, top, right, bottom = area_of(points, EYES[0] + EYES[1], face * 0.02, frame.shape)
    part = done[top:bottom, left:right].astype(np.float32)
    part = lighten_whites(part, white_mask(part.shape[:2], points - (left, top), face))
    done[top:bottom, left:right] = np.clip(part + 0.5, 0, 255).astype(np.uint8)
    return done


def close_up(frame: np.ndarray, points: np.ndarray) -> np.ndarray:
    face = float(np.linalg.norm(points[BROW_TOP] - points[CHIN]))
    middle = points[FACE_OVAL, :].mean(axis=0)
    half = min(int(face * 0.6), frame.shape[1] // 2, frame.shape[0] // 2)
    left = int(np.clip(middle[0] - half, 0, frame.shape[1] - 2 * half))
    top = int(np.clip(middle[1] - half, 0, frame.shape[0] - 2 * half))
    return cv2.resize(frame[top:top + 2 * half, left:left + 2 * half], (720, 720), interpolation=cv2.INTER_AREA)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("before")
    parser.add_argument("folder")
    parser.add_argument("--encoder", default="libx264")
    parser.add_argument("--close-up", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--close-up-from", type=float, default=3)
    args = parser.parse_args()
    folder = Path(args.folder)

    options = vision.FaceLandmarkerOptions(
        base_options=tasks.BaseOptions(model_asset_path=str(model_path())),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=1,
    )
    landmarker = vision.FaceLandmarker.create_from_options(options)
    started = time.monotonic()
    # ffmpeg converts both ways with the same BT.709 matrix, so the untouched pixels come back as they went in.
    reader = subprocess.Popen(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", args.before, "-map", "0:v:0",
         "-vf", "scale=in_color_matrix=bt709:in_range=tv,format=bgr24", "-f", "rawvideo", "-"],
        stdout=subprocess.PIPE,
    )
    writer = subprocess.Popen(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{WIDTH}x{HEIGHT}", "-r", str(RATE), "-i", "-",
         "-i", args.before, "-map", "0:v:0", "-map", "1:a:0",
         "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
         "-c:v", args.encoder, "-profile:v", "high", "-b:v", "10M", "-maxrate", "12M", "-bufsize", "24M", "-g", str(RATE * 2),
         "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
         "-c:a", "copy", "-map_metadata", "-1", "-movflags", "+faststart", str(folder / "after.mp4")],
        stdin=subprocess.PIPE,
    )
    size = WIDTH * HEIGHT * 3
    frames = 0
    steady: np.ndarray | None = None
    pictured = False
    while True:
        raw = reader.stdout.read(size)
        if len(raw) < size:
            break
        frame = np.frombuffer(raw, np.uint8).reshape(HEIGHT, WIDTH, 3)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        seen = landmarker.detect_for_video(image, frames * 1000 // RATE)
        done = frame
        if seen.face_landmarks:
            points = np.array([(point.x * WIDTH, point.y * HEIGHT) for point in seen.face_landmarks[0]], np.float32)
            face = float(np.linalg.norm(points[BROW_TOP] - points[CHIN]))
            if steady is None or np.mean(np.linalg.norm(points - steady, axis=1)) > face * 0.05:
                steady = points
            else:
                steady = steady + (points - steady) * STEADY
            done = retouch(frame, steady)
            if args.close_up and not pictured and frames >= RATE * args.close_up_from:
                cv2.imwrite(str(folder / "before.jpg"), close_up(frame, steady), [cv2.IMWRITE_JPEG_QUALITY, 92])
                cv2.imwrite(str(folder / "after.jpg"), close_up(done, steady), [cv2.IMWRITE_JPEG_QUALITY, 92])
                pictured = True
        else:
            steady = None
        writer.stdin.write(done.tobytes())
        frames += 1
        if frames % RATE == 0:
            print(f"frames={frames}", flush=True)
    writer.stdin.close()
    if reader.wait() != 0 or writer.wait() != 0 or frames == 0:
        print("The video cannot be read or written.", file=sys.stderr)
        raise SystemExit(65)
    if args.close_up and not pictured:
        print(f"No face was found after the first {args.close_up_from:g} seconds, so there is no close-up.", file=sys.stderr)
        raise SystemExit(66)
    took = time.monotonic() - started
    result = {"seconds": frames / RATE, "took": round(took, 2)}
    (folder / "retouch.json").write_text(json.dumps(result), encoding="utf-8")


main()
