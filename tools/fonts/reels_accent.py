import sys

from fontTools.ttLib import TTFont

# The SIL Open Font License reserves the name Playfair Display for the unchanged font.
FAMILY = "Reels Accent"
POSTSCRIPT = "ReelsAccent-Italic"
DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]


def main(source: str, target: str) -> None:
    font = TTFont(source)
    # libass turns on no OpenType feature, so the lining figures have to stand in the cmap.
    glyphs = set(font.getGlyphOrder())
    for table in font["cmap"].tables:
        for code, name in list(table.cmap.items()):
            if name in DIGITS and f"{name}.lf" in glyphs:
                table.cmap[code] = f"{name}.lf"
    names = font["name"]
    for record in list(names.names):
        if record.platformID == 1 or record.nameID in (1, 3, 4, 6, 16, 17, 21, 22):
            names.removeNames(platformID=record.platformID, nameID=record.nameID)
    names.setName(FAMILY, 1, 3, 1, 0x409)
    names.setName("Italic", 2, 3, 1, 0x409)
    names.setName(f"1.0;{POSTSCRIPT}", 3, 3, 1, 0x409)
    names.setName(f"{FAMILY} Italic", 4, 3, 1, 0x409)
    names.setName(POSTSCRIPT, 6, 3, 1, 0x409)
    names.setName("Playfair Display Italic by The Playfair Display Project Authors, with lining figures as the default digits, under the SIL Open Font License 1.1.", 10, 3, 1, 0x409)
    font.save(target)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
