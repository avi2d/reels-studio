import argparse
import json
from pathlib import Path

import pypdfium2 as pdfium

PAGE_WIDTH = 1800


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("page", type=int)
    parser.add_argument("picture")
    parser.add_argument("chars")
    args = parser.parse_args()

    document = pdfium.PdfDocument(args.pdf)
    page = document[args.page - 1]
    scale = PAGE_WIDTH / page.get_width()
    image = page.render(scale=scale).to_pil().convert("RGB")
    image.save(args.picture)
    text = page.get_textpage()
    height = page.get_height()
    chars = []
    for index in range(text.count_chars()):
        left, bottom, right, top = text.get_charbox(index)
        chars.append({
            "text": text.get_text_range(index, 1),
            "left": left * scale,
            "top": (height - top) * scale,
            "right": right * scale,
            "bottom": (height - bottom) * scale,
        })
    result = {"width": image.width, "height": image.height, "chars": chars}
    Path(args.chars).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


main()
