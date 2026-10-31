#!/usr/bin/env bash
# Renders a contact sheet of animation clips at several phases (dev tool).
#   tools/anim_sheet.sh out.png yaw clip1,clip2,... [phases]
set -euo pipefail
OUT=$1; YAW=$2; CLIPS=$3; PHASES=${4:-"0 0.25 0.5 0.75"}
GODOT=${GODOT:-godot}
TMP=$(mktemp -d)
json_clips=$(python3 -c "import json,sys;print(json.dumps(sys.argv[1].split(',')))" "$CLIPS")
i=0
for p in $PHASES; do
  xvfb-run -a -s "-screen 0 1600x900x24" "$GODOT" --path . --rendering-method mobile --resolution 1600x900 \
    -s res://tools/capture.gd -- res://scenes/player_lab.tscn "$TMP/$i" 1 1.5 \
    "{\"clips\":$json_clips,\"phase\":$p,\"yaw\":$YAW}" >/dev/null 2>&1
  i=$((i+1))
done
python3 - "$TMP" "$OUT" <<'PY'
import sys, glob
from PIL import Image
tmp, out = sys.argv[1], sys.argv[2]
ims = [Image.open(f).crop((0, 120, 1600, 760)) for f in sorted(glob.glob(tmp + "/*/shot_00.png"))]
W = Image.new("RGB", (1600, 640 * len(ims)))
for k, im in enumerate(ims):
    W.paste(im, (0, 640 * k))
W.resize((1200, int(480 * len(ims)))).save(out)
PY
rm -rf "$TMP"
