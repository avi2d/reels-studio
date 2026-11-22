import argparse
import ctypes
import json
from pathlib import Path

import pypdfium2 as pdfium

PAGE_WIDTH = 1800


def device_box(
    page: pdfium.PdfPage,
    size: tuple[int, int],
    box: tuple[float, float, float, float],
) -> dict[str, int]:
    left, bottom, right, top = box
    points = []
    for x in [left, right]:
        for y in [bottom, top]:
            device_x, device_y = ctypes.c_int(), ctypes.c_int()
            if not pdfium.raw.FPDF_PageToDevice(
                page.raw, 0, 0, *size, 0, x, y,
                ctypes.byref(device_x), ctypes.byref(device_y),
            ):
                raise RuntimeError("Cannot map a character to the rendered page")
            points.append((device_x.value, device_y.value))
    return {
        "left": min(x for x, _ in points),
        "top": min(y for _, y in points),
        "right": max(x for x, _ in points),
        "bottom": max(y for _, y in points),
    }


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
    chars = []
    for index in range(text.count_chars()):
        chars.append({
            "text": text.get_text_range(index, 1),
            **device_box(page, image.size, text.get_charbox(index)),
        })
    result = {"width": image.width, "height": image.height, "chars": chars}
    Path(args.chars).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


main()
