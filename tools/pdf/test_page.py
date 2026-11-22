import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image, ImageChops


def write_pdf(path: Path, rotation: int, crop: tuple[int, int, int, int]) -> None:
    content = b"BT /F1 24 Tf 90 140 Td (H) Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] "
            f"/CropBox [{' '.join(map(str, crop))}] /Rotate {rotation} "
            f"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
        ).encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream",
    ]
    data = bytearray(b"%PDF-1.4\n")
    offsets = []
    for index, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(data)
    data.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        data.extend(f"{offset:010} 00000 n \n".encode())
    data.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    path.write_bytes(data)


class PageCoordinates(unittest.TestCase):
    def test_rotated_and_offset_crop_boxes_follow_ink_not_unrotated_coordinates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            for crop in [(0, 0, 300, 220), (36, 36, 264, 204)]:
                for rotation in [0, 90, 180, 270]:
                    with self.subTest(rotation=rotation, crop=crop):
                        pdf = work / "page.pdf"
                        picture = work / "page.png"
                        chars = work / "chars.json"
                        write_pdf(pdf, rotation, crop)
                        subprocess.run(
                            [sys.executable, str(Path(__file__).with_name("page.py")),
                             str(pdf), "1", str(picture), str(chars)],
                            check=True, capture_output=True,
                        )
                        result = json.loads(chars.read_text())
                        with Image.open(picture) as image:
                            ink = ImageChops.invert(image.convert("L")).point(
                                lambda value: 255 if value > 128 else 0
                            ).getbbox()
                            self.assertEqual((result["width"], result["height"]), image.size)
                        self.assertIsNotNone(ink)
                        letter, = [char for char in result["chars"] if char["text"] == "H"]
                        box = tuple(letter[side] for side in ["left", "top", "right", "bottom"])
                        for actual, expected in zip(box, ink):
                            self.assertAlmostEqual(actual, expected, delta=3)


if __name__ == "__main__":
    unittest.main()
