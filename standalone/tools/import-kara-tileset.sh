#!/bin/sh
# Unpacks the licensed gameart2d "Sci-fi Top Down Tileset" (not redistributable,
# never commit it) into public/kara-tiles/ (gitignored) under the names
# src/lib/kara/kara-tiles.ts loads (TILE_NAMES). The widget build copies that
# folder to dist/kara-tiles/ when it exists.
#
#   standalone/tools/import-kara-tileset.sh ~/Downloads/gameart.zip
#
# Mapping, read off the pack's images:
#   wall-<n>          png/tiles/TileSep-<n>   (pieces 1..35; numbering = WALL_PIECES)
#   face / face-alt / face-sign   TileSep-37 / -45 / -43  (wall fronts, stripe at the floor)
#   floor / grate / acid          TileSep-47 / -49 / -59
#   objects: green/red/yellow barrels, box, door, lasers, locker, tables, terminal, switch
set -eu

ZIP=${1:?usage: $0 path/to/gameart.zip}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT="$ROOT/public/kara-tiles"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

unzip -q "$ZIP" 'png/*' -d "$TMP"
P="$TMP/png"
mkdir -p "$OUT"

for n in $(seq 1 35); do cp "$P/tiles/TileSep-$n.png" "$OUT/wall-$n.png"; done

cp "$P/tiles/TileSep-37.png"                "$OUT/face.png"
cp "$P/tiles/TileSep-45.png"                "$OUT/face-alt.png"
cp "$P/tiles/TileSep-43.png"                "$OUT/face-sign.png"
cp "$P/tiles/TileSep-47.png"                "$OUT/floor.png"
cp "$P/tiles/TileSep-49.png"                "$OUT/grate.png"
cp "$P/tiles/TileSep-59.png"                "$OUT/acid.png"
cp "$P/objects/Barrel/Green (2).png"        "$OUT/item.png"
cp "$P/objects/Barrel/Red (2).png"          "$OUT/barrel-red.png"
cp "$P/objects/Barrel/Yellow (1).png"       "$OUT/barrel-yellow.png"
cp "$P/objects/Box (1).png"                 "$OUT/box.png"
cp "$P/objects/Door/Door (1).png"           "$OUT/door-closed.png"
cp "$P/objects/Door/Door (5).png"           "$OUT/door-open.png"
cp "$P/objects/laser/HorizontalLaser (1).png" "$OUT/laser-h.png"
cp "$P/objects/laser/VerticalLaser (1).png" "$OUT/laser-v.png"
cp "$P/objects/Locker (1).png"              "$OUT/locker.png"
cp "$P/objects/Table (2).png"               "$OUT/table.png"
cp "$P/objects/Table (1).png"               "$OUT/desk.png"
cp "$P/objects/Tile_17.png"                 "$OUT/terminal.png"
cp "$P/objects/Switch (1).png"              "$OUT/switch.png"

# Kara draws tiles at ~40 px (max tile size per level); 128 px covers 2x
# screens and cuts the set from ~11 MB to well under 1 MB. sips is macOS-only;
# elsewhere the originals are kept.
if command -v sips >/dev/null; then sips -Z 128 "$OUT"/*.png >/dev/null; fi

echo "$(ls "$OUT" | wc -l | tr -d ' ') tiles in $OUT ($(du -sh "$OUT" | cut -f1))"
