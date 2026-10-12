#!/bin/bash
# 显示托管 muse2api 实例的接入信息:地址、key、模型,
# 给 magpie 手填的字段,和 cc-switch 的一键导入链接。
set -u
MANAGED="${MUSE2API_PLUGIN_HOME:-$HOME/.muse2api-plugin}"
ENV_FILE="$MANAGED/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "没有找到托管安装 ($ENV_FILE)。"
  echo "先运行一键安装完成一次管家安装，这里才有信息可显示。"
  exit 1
fi
KEY="$(grep -o '^MUSE2API_KEY=[^[:space:]]*' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [ -z "${KEY:-}" ]; then
  echo ".env 里没有 MUSE2API_KEY，安装可能没完成。"
  exit 1
fi
BASE="http://127.0.0.1:18610/v1"
EP="http%3A%2F%2F127.0.0.1%3A18610%2Fv1"
NAME="Muse+%28muse2api%29"
HP="https%3A%2F%2Fmuse.ai"
NOTES="Muse+%28muse.ai%29+through+a+local+muse2api+instance"
echo
echo "========== muse2api 接入信息 =========="
echo "API 地址: $BASE"
echo "API Key : $KEY"
echo "模型    : muse-spark"
echo
echo "-- 已经在用 magpie: 新建自定义供应商, 四项照上面填 --"
echo "   供应商名 muse2api / 地址 / key / 模型 muse-spark"
echo
echo "-- 已经在用 cc-switch: 把对应链接粘到浏览器打开, 即刻导入 --"
echo "Codex   : ccswitch://v1/import?resource=provider&app=codex&name=$NAME&homepage=$HP&endpoint=$EP&apiKey=$KEY&model=muse-spark&enabled=true&notes=$NOTES"
echo "OpenCode: ccswitch://v1/import?resource=provider&app=opencode&name=$NAME&homepage=$HP&endpoint=$EP&apiKey=$KEY&model=muse-spark&enabled=true&notes=$NOTES"
echo "========================================="
