import argparse
import json
import math
import wave
from pathlib import Path

import onnx_asr

PUNCTUATION = set(".,!?;:…—–-«»\"()")


def is_punctuation(token: str) -> bool:
    return token != "" and all(char in PUNCTUATION for char in token)


def words_of(segment) -> list[dict]:
    words: list[dict] = []
    opens_word = True
    for token, offset, logprob in zip(segment.tokens, segment.timestamps, segment.logprobs):
        if token.startswith(" "):
            opens_word = True
        text = token.strip()
        if text == "":
            continue
        joins_previous = is_punctuation(text) and text not in ("«", "(") and words
        if opens_word and not joins_previous:
            words.append({"start": segment.start + offset, "text": text, "logprob": 0.0})
            opens_word = False
        elif words:
            words[-1]["text"] += text
        if words and not is_punctuation(text):
            words[-1]["logprob"] += logprob
    # The recognizer times only the first sound of a word, so inside one stretch of speech
    # a word ends where the next one starts and the last one ends with the stretch.
    for word, following in zip(words, words[1:]):
        word["end"] = following["start"]
    if words:
        words[0]["start"] = max(segment.start, min(words[0]["start"], segment.end))
        words[-1]["end"] = max(segment.end, words[-1]["start"])
    return words


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("output")
    parser.add_argument("--model", default="gigaam-v3-e2e-rnnt")
    parser.add_argument("--providers", help="onnxruntime providers separated by commas, in order of preference")
    args = parser.parse_args()
    providers = args.providers.split(",") if args.providers else None

    with wave.open(args.audio, "rb") as audio:
        duration = round(audio.getnframes() / audio.getframerate(), 3)

    vad = onnx_asr.load_vad("silero", providers=providers)
    model = onnx_asr.load_model(args.model, providers=providers).with_vad(vad, min_silence_duration_ms=150, speech_pad_ms=30).with_timestamps()
    segments = list(model.recognize(args.audio))
    words = [
        {"start": round(word["start"], 3), "end": round(word["end"], 3), "text": word["text"], "sure": round(math.exp(word["logprob"]), 2)}
        for segment in segments
        for word in words_of(segment)
    ]
    result = {
        "duration": duration,
        "words": words,
    }
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


main()
