# Hoop Legacy

Web game source (`www/`) for the Hoop Legacy Android app (Capacitor + three.js).

Rebuild the APK after editing `www/`:

```sh
pip install cryptography
python3 tools/repack.py tools/base.apk HoopLegacy.apk
```

`tools/base.apk` is the original app shell; `repack.py` swaps in `www/` as `assets/public`,
zip-aligns, and signs with APK Signature Scheme v2 using `tools/signing-key.pem`
(a self-made key: keep using it so new builds install as updates over each other).

## Player models

`www/models/` (players.json + players.bin + textures) is generated from the MakeHuman CC0 assets in
this folder (`proxymeshes/`, `hair/`, skins, `eyes/`):

```sh
# needs ImageMagick (`convert`) on the PATH
python3 tools/build_models.py
```

It skins the athletic body to the game's rig and cuts the jersey and shorts from it. The game loads
the pack at startup and falls back to the built-in procedural players if it's missing (the Low
graphics setting also uses the procedural players).
