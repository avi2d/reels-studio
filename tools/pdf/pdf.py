import argparse
import json
from pathlib import Path

import pypdfium2 as pdfium

PAGE_WIDTH = 1200


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("folder")
    parser.add_argument("--pages", type=int, default=4)
    args = parser.parse_args()

    folder = Path(args.folder)
    folder.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(args.pdf)
    texts: list[str] = []
    for index in range(len(document)):
        page = document[index]
        texts.append(page.get_textpage().get_text_bounded().strip())
        if index < args.pages:
            scale = PAGE_WIDTH / page.get_width()
            page.render(scale=scale).to_pil().convert("RGB").save(folder / f"page-{index + 1}.jpg", quality=85)
    result = {"pages": len(document), "texts": texts}
    (folder / "pdf.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


main()
