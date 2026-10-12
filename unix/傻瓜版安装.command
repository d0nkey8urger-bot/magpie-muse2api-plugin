#!/bin/bash
# muse2api 傻瓜版一键安装 (macOS / Linux) —— 不需要 magpie:
# 运行同目录(发布包)或仓库根目录的 muse2api-setup.py。
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$DIR/muse2api-setup.py" ]; then SETUP="$DIR/muse2api-setup.py";
elif [ -f "$DIR/../muse2api-setup.py" ]; then SETUP="$DIR/../muse2api-setup.py";
else echo "没有找到 muse2api-setup.py(它应该和本脚本在同一个发布包里)。"; exit 1; fi
PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "[需要 Python] 没有找到 Python 3.10+，先装一个: https://www.python.org/downloads/"
  read -r -p "按回车关闭…" _ || true
  exit 1
fi
"$PY" "$SETUP"
read -r -p "按回车关闭…" _ || true
