#!/bin/bash
# Patch Aztec PXE tagging window from 20 to 100.
# On testnet, block finalization is slow and active voters hit the default limit.
# This runs as a postinstall hook after yarn install.

TARGET="node_modules/@aztec/pxe/dest/tagging/constants.js"
if [ -f "$TARGET" ]; then
  sed -i.bak 's/UNFINALIZED_TAGGING_INDEXES_WINDOW_LEN = 20/UNFINALIZED_TAGGING_INDEXES_WINDOW_LEN = 100/' "$TARGET"
  rm -f "${TARGET}.bak"
  echo "[patch] Tagging window increased to 100 in $TARGET"
fi

TARGET_SRC="node_modules/@aztec/pxe/src/tagging/constants.ts"
if [ -f "$TARGET_SRC" ]; then
  sed -i.bak 's/UNFINALIZED_TAGGING_INDEXES_WINDOW_LEN = 20/UNFINALIZED_TAGGING_INDEXES_WINDOW_LEN = 100/' "$TARGET_SRC"
  rm -f "${TARGET_SRC}.bak"
  echo "[patch] Tagging window increased to 100 in $TARGET_SRC"
fi
