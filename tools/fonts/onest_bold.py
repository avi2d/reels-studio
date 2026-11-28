import sys

from fontTools.merge import Merger
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

FAMILY = "Onest Bold"
POSTSCRIPT = "Onest-Bold"
PARTS = ["onest-cyrillic.woff2", "onest-latin.woff2"]


def main(source: str, work: str, target: str) -> None:
    # libass reads one static font, while the page fonts are variable and split by script.
    statics = []
    for part in PARTS:
        font = instancer.instantiateVariableFont(TTFont(f"{source}/{part}"), {"wght": 700})
        font.flavor = None
        path = f"{work}/{part}.ttf"
        font.save(path)
        statics.append(path)
    merged = Merger().merge(statics)
    names = merged["name"]
    for record in list(names.names):
        if record.nameID in (1, 2, 3, 4, 6, 16, 17):
            names.removeNames(platformID=record.platformID, nameID=record.nameID)
    names.setName(FAMILY, 1, 3, 1, 0x409)
    names.setName("Regular", 2, 3, 1, 0x409)
    names.setName(f"1.0;{POSTSCRIPT}", 3, 3, 1, 0x409)
    names.setName(FAMILY, 4, 3, 1, 0x409)
    names.setName(POSTSCRIPT, 6, 3, 1, 0x409)
    merged.flavor = None
    merged.save(target)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
