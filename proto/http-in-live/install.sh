#!/usr/bin/env bash
# install.sh — symlink the proto Remote Script into Live's user library,
# then pull vendored Python deps that Live's bundled Python can import.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROTO_PKG="$SCRIPT_DIR/remote_script/agent4live_proto"
TARGET="$HOME/Music/Ableton/User Library/Remote Scripts/agent4live_proto"

if [[ -e "$TARGET" ]]; then
  echo "Target already exists: $TARGET"
  echo "Remove it first: rm \"$TARGET\""
  exit 1
fi

mkdir -p "$HOME/Music/Ableton/User Library/Remote Scripts"
ln -s "$PROTO_PKG" "$TARGET"
echo "Symlinked: $TARGET → $PROTO_PKG"

VENDOR="$PROTO_PKG/_vendor"
echo "Pulling vendored Python deps into $VENDOR ..."
python3.11 -m pip install \
  --target "$VENDOR" \
  --no-deps \
  mcp pydantic anyio httpx starlette uvicorn h11 idna sniffio typing_extensions \
  pydantic_core annotated_types
echo "Vendored deps installed."
echo ""
echo "Next step:"
echo "  Open Live → Preferences → Link/Tempo/MIDI → assign 'agent4live_proto'"
echo "  to a Control Surface slot (different from the prod 'agent4live')."
