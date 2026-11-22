"""Regenerate the two embedded Reader fonts with Python 3 and fonttools 4.61.1.

Use the Noto source versions listed in ../pdf-assets/FONT-LICENSE.txt. The
regular and bold monochrome emoji WOFFs are in the "files" directory of the
@fontsource/noto-emoji@5.3.2 npm tarball. Example from the repository root:

    python3 Reader/_tools/build-pdf-fonts.py \
        --noto-dir /usr/share/fonts/truetype/noto \
        --cjk-dir /usr/share/fonts/opentype/noto \
        --emoji-dir /path/to/unpacked/package/files

The default manuscript is Crumbs.txt and the output directory is Reader/pdf-assets.
"""
import argparse
from pathlib import Path
from tempfile import TemporaryDirectory

from fontTools import subset
from fontTools.misc.transform import Transform
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable

READER = Path(__file__).resolve().parents[1]
CIRCLES = {0x1F534, 0x1F535, *range(0x1F7E0, 0x1F7E5)}
COPYRIGHT = (
    'Copyright 2013–2026 Google LLC. Copyright 2017 Google Inc. Copyright 2014–2021 Adobe. '
    'Reader Sans is a modified Noto font distributed under the SIL Open Font License, Version 1.1.'
)


def common_east_asian_characters():
    # JIS X 0208 level 1 and KS X 1001 modern Hangul syllables.
    result = set()
    for codec, first, last in [('euc_jp', 0xb0, 0xcf), ('euc_kr', 0xb0, 0xc8)]:
        for lead in range(first, last + 1):
            for trail in range(0xa1, 0xff):
                try:
                    result.add(ord(bytes([lead, trail]).decode(codec)))
                except UnicodeDecodeError:
                    continue
    result.update(range(0x3000, 0x3100))  # CJK punctuation, hiragana and katakana
    result.update(range(0x3130, 0x3190))  # Hangul compatibility jamo
    return result


def add_outlines(base, cmap, source, wanted, aliases=None):
    source_map = source.getBestCmap()
    source_glyphs = source.getGlyphSet()
    scale = base['head'].unitsPerEm / source['head'].unitsPerEm
    aliases = aliases or {}
    for cp in sorted(wanted - cmap.keys()):
        source_name = source_map.get(aliases.get(cp, cp))
        if not source_name:
            continue
        glyph_name = f'reader{cp:X}'
        recording = DecomposingRecordingPen(source_glyphs)
        source_glyphs[source_name].draw(recording)
        pen = TTGlyphPen(None)
        converter = Cu2QuPen(pen, max_err=0.7, reverse_direction=True) if 'CFF ' in source else pen
        recording.replay(TransformPen(converter, Transform().scale(scale)))
        glyph = pen.glyph()
        glyph.recalcBounds(base['glyf'])
        base['glyf'][glyph_name] = glyph
        source_width = source['hmtx'][source_name][0]
        base['hmtx'][glyph_name] = (round(source_width * scale), getattr(glyph, 'xMin', 0))
        cmap[cp] = glyph_name


def build(weight, requested, sources, target):
    base = TTFont(sources.noto_dir / f'NotoSans-{weight}.ttf', recalcTimestamp=False)
    cmap = dict(base.getBestCmap())

    symbols2 = TTFont(sources.noto_dir / 'NotoSansSymbols2-Regular.ttf')
    add_outlines(base, cmap, symbols2, CIRCLES, {cp: 0x25CF for cp in CIRCLES})
    math = TTFont(sources.noto_dir / 'NotoSansMath-Regular.ttf')
    add_outlines(base, cmap, math, set(math.getBestCmap()))
    misc = set(range(0x2000, 0x2C00))
    add_outlines(base, cmap, TTFont(sources.noto_dir / f'NotoSansSymbols-{weight}.ttf'), requested | misc)
    add_outlines(base, cmap, symbols2, requested | misc)

    emoji_weight = 400 if weight == 'Regular' else 700
    emoji = TTFont(sources.emoji_dir / f'noto-emoji-emoji-{emoji_weight}-normal.woff')
    add_outlines(base, cmap, emoji, {cp for cp in emoji.getBestCmap() if cp >= 0x1f000} | requested)
    cjk = TTFont(sources.cjk_dir / f'NotoSansCJK-{weight}.ttc', fontNumber=0)
    add_outlines(base, cmap, cjk, common_east_asian_characters() | requested)

    missing = requested.difference(cmap)
    if missing:
        raise ValueError('Unmapped manuscript code points: ' + ', '.join(f'U+{cp:04X}' for cp in sorted(missing)))

    base.setGlyphOrder(base['glyf'].glyphOrder)
    for table in base['cmap'].tables:
        if table.format == 4:
            table.cmap = {cp: name for cp, name in cmap.items() if cp < 0x10000}
    for platform, encoding in [(0, 4), (3, 10)]:
        table = CmapSubtable.newSubtable(12)
        table.platformID, table.platEncID, table.language, table.cmap = platform, encoding, 0, cmap
        base['cmap'].tables.append(table)
    # Outlines stay sharp at arbitrary zoom. Keep the original Latin layout and
    # mark-positioning tables while dropping instructions for pixel-grid hinting.
    options = subset.Options()
    options.hinting = False
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.name_languages = ['*']
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=list(cmap))
    subsetter.subset(base)
    names = base['name']
    replacements = {0: COPYRIGHT, 1: 'Reader Sans', 2: weight,
                    3: f'ReaderSans-{weight}-1.000', 4: f'Reader Sans {weight}',
                    5: 'Version 1.000', 6: f'ReaderSans-{weight}',
                    8: 'Reader Sans contributors', 10: 'Composite font for Crumb Reader PDF export.'}
    for item in names.names[:]:
        if item.nameID in replacements or item.nameID in {7, 8, 9, 10, 11, 12, 16, 17, 21, 22}:
            names.names.remove(item)
    for ident, value in replacements.items():
        names.setName(value, ident, 3, 1, 0x409)
    base['OS/2'].recalcUnicodeRanges(base)
    base['head'].modified = base['head'].created
    base.flavor = 'woff'
    base.save(target)
    check = TTFont(target)
    assert requested <= check.getBestCmap().keys()
    assert len({check.getBestCmap()[cp] for cp in CIRCLES}) == len(CIRCLES)
    print(f'{target.name}: {target.stat().st_size:,} bytes / {len(check.getBestCmap()):,} code points')


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--noto-dir', required=True, type=Path, help='Noto Sans, Math and Symbols TTF directory')
    parser.add_argument('--cjk-dir', required=True, type=Path, help='Noto Sans CJK TTC directory')
    parser.add_argument('--emoji-dir', required=True, type=Path, help='Fontsource Noto Emoji WOFF directory')
    parser.add_argument('--corpus', type=Path, default=READER.parent / 'Crumbs.txt')
    parser.add_argument('--output-dir', type=Path, default=READER / 'pdf-assets')
    args = parser.parse_args()

    requested = {ord(char) for char in args.corpus.read_text(encoding='utf-8') if not char.isspace()}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=args.output_dir) as staging:
        for weight, name in [('Regular', 'reader-sans.woff'), ('Bold', 'reader-sans-bold.woff')]:
            build(weight, requested, args, Path(staging) / name)
        for font_file in Path(staging).glob('*.woff'):
            font_file.replace(args.output_dir / font_file.name)


if __name__ == '__main__':
    main()
