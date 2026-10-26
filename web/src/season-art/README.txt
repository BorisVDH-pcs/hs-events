Seasonal decoration, kept out of public/icons/ on purpose.

build-icon-manifest.mjs generates lib/icons.js from public/icons/, and every
file in there becomes a tile a bingo can be built from. A pumpkin that only
exists to sit beside the wordmark in late October has no business in that
list, so the season's art lives here instead and is referenced from
seasons.css -- which also means Vite fingerprints it and rewrites the path
for the /hs-events/ base, rather than it being a bare public URL that only
resolves locally.

pumpkin.png -- 23x20, from the Old School RuneScape Wiki, the same source
and the same terms as the tile icons in public/icons/:
https://oldschool.runescape.wiki/w/File:Pumpkin.png
Unmodified, at its native size: it is drawn at about 24px, so there was
nothing to rescale and no interpolation to get wrong.
