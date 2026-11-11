#!/usr/bin/env bash
# Builds an unsigned Release .ipa for sideloading with AltStore (it signs the app itself).
set -euo pipefail
cd "$(dirname "$0")/ios"

NAME=SocialGiorgiovolaCasa
OUT="$(cd .. && pwd)/build"
ARCHIVE="$OUT/$NAME.xcarchive"

rm -rf "$ARCHIVE" "$OUT/Payload" "$OUT/$NAME.ipa"
mkdir -p "$OUT"

xcodebuild -workspace "$NAME.xcworkspace" -scheme "$NAME" -configuration Release \
	-destination 'generic/platform=iOS' -archivePath "$ARCHIVE" archive \
	CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=""

mkdir -p "$OUT/Payload"
cp -R "$ARCHIVE/Products/Applications/$NAME.app" "$OUT/Payload/"
(cd "$OUT" && zip -qr "$NAME.ipa" Payload && rm -rf Payload)
echo "Built $OUT/$NAME.ipa"
