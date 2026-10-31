#!/usr/bin/env bash
# Builds an installable debug APK: build/android/courtside-debug.apk
#
#   GODOT=/path/to/godot ANDROID_SDK_ROOT=/path/to/sdk tools/build_android.sh
#
# Needs: Godot 4.7 + its export templates, an Android SDK with platform-tools
# and build-tools (apksigner), and a JDK 17+. A debug keystore is generated on
# first run. Install with:  adb install -r build/android/courtside-debug.apk
set -euo pipefail
cd "$(dirname "$0")/.."

GODOT="${GODOT:-godot}"
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Android/Sdk}}"
JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")}"
KEYSTORE="${DEBUG_KEYSTORE:-$HOME/.android/debug.keystore}"
VERSION=$("$GODOT" --version | sed -E 's/^([0-9]+\.[0-9]+).*/\1/')

if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -v -keystore "$KEYSTORE" -storepass android -alias androiddebugkey \
    -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi

# Point the (headless) editor at the SDK and JDK.
CFG="${XDG_CONFIG_HOME:-$HOME/.config}/godot"
mkdir -p "$CFG"
cat > "$CFG/editor_settings-$VERSION.tres" <<EOT
[gd_resource type="EditorSettings" format=3]

[resource]
export/android/android_sdk_path = "$SDK"
export/android/java_sdk_path = "$JAVA_HOME"
export/android/debug_keystore = "$KEYSTORE"
export/android/debug_keystore_user = "androiddebugkey"
export/android/debug_keystore_pass = "android"
EOT

export GODOT_ANDROID_KEYSTORE_DEBUG_PATH="$KEYSTORE"
export GODOT_ANDROID_KEYSTORE_DEBUG_USER="androiddebugkey"
export GODOT_ANDROID_KEYSTORE_DEBUG_PASSWORD="android"

mkdir -p build/android
"$GODOT" --headless --path . --import >/dev/null 2>&1 || true
"$GODOT" --headless --path . --export-debug "Android" build/android/courtside-debug.apk
ls -lh build/android/courtside-debug.apk
