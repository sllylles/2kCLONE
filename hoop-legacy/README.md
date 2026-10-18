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
