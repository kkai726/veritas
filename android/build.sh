#!/usr/bin/env bash
# 不依赖 Gradle 的 APK 构建脚本：aapt2 → javac → d8 → zipalign → apksigner
#
# 需要：JDK 17+、Android SDK 的 build-tools 与 platform
#   ANDROID_SDK=/d/devkit/android-sdk
#   JAVA_HOME=/d/devkit/jdk-17.0.21.1+2
#   BUILD_TOOLS=35.0.0
set -euo pipefail

cd "$(dirname "$0")"

SDK="${ANDROID_SDK:-/d/devkit/android-sdk}"
JAVA_HOME="${JAVA_HOME:-/d/devkit/jdk-17.0.21.1+2}"
BT_VERSION="${BUILD_TOOLS:-35.0.0}"
BT="$SDK/build-tools/$BT_VERSION"
PLATFORM="${PLATFORM:-android-35}"
ANDROID_JAR="$SDK/platforms/$PLATFORM/android.jar"
JAVA="$JAVA_HOME/bin/java"
JAVAC="$JAVA_HOME/bin/javac"
JAR="$JAVA_HOME/bin/jar"
KEYTOOL="$JAVA_HOME/bin/keytool"

APP="app/src/main"
OUT="build/apk"
KEYSTORE="build/veritas-debug.keystore"
KEYPASS="veritas"

for f in "$BT/aapt2.exe" "$BT/zipalign.exe" "$BT/lib/d8.jar" "$BT/lib/apksigner.jar" "$ANDROID_JAR"; do
  [ -e "$f" ] || { echo "缺少 $f，请先安装 Android build-tools 与 platform"; exit 1; }
done

rm -rf "$OUT"
mkdir -p "$OUT/res" "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "· 拷贝前端产物到 assets"
rm -rf "$APP/assets/public"
mkdir -p "$APP/assets"
cp -r ../dist "$APP/assets/public"

echo "· 编译资源"
"$BT/aapt2.exe" compile --dir "$APP/res" -o "$OUT/res/resources.zip"
"$BT/aapt2.exe" link \
  -o "$OUT/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$APP/AndroidManifest.xml" \
  -R "$OUT/res/resources.zip" \
  --java "$OUT/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 35 \
  --version-code 1 \
  --version-name "1.0" \
  --auto-add-overlay

echo "· 写入前端资源"
python zip-assets.py "$OUT/base.apk" "$APP/assets"

echo "· 编译 Java"
find "$APP/java" "$OUT/gen" -name "*.java" > "$OUT/sources.txt"
"$JAVAC" -encoding UTF-8 -source 17 -target 17 \
  -classpath "$ANDROID_JAR" \
  -d "$OUT/classes" @"$OUT/sources.txt" 2>&1 | grep -v "bootstrap class path\|source value 17\|target value 17\|deprecat" || true

echo "· 转 dex"
find "$OUT/classes" -name "*.class" > "$OUT/classes.txt"
"$JAVA" -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 \
  --lib "$ANDROID_JAR" --min-api 24 --output "$OUT/dex" @"$OUT/classes.txt"

echo "· 打包 dex"
"$JAR" uf "$OUT/base.apk" -C "$OUT/dex" classes.dex

echo "· 对齐"
"$BT/zipalign.exe" -f 4 "$OUT/base.apk" "$OUT/aligned.apk"

if [ ! -f "$KEYSTORE" ]; then
  echo "· 生成调试签名"
  "$KEYTOOL" -genkeypair -keystore "$KEYSTORE" -alias veritas \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KEYPASS" -keypass "$KEYPASS" \
    -dname "CN=Veritas, OU=Dev, O=Veritas, L=Beijing, ST=Beijing, C=CN" >/dev/null 2>&1
fi

echo "· 签名"
"$JAVA" -jar "$BT/lib/apksigner.jar" sign \
  --ks "$KEYSTORE" --ks-pass "pass:$KEYPASS" --key-pass "pass:$KEYPASS" --ks-key-alias veritas \
  --out "$OUT/veritas.apk" "$OUT/aligned.apk"

"$JAVA" -jar "$BT/lib/apksigner.jar" verify "$OUT/veritas.apk"

echo "✅ 产物：$(pwd)/$OUT/veritas.apk"
ls -lh "$OUT/veritas.apk"
