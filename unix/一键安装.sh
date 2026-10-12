#!/bin/bash
# muse2api one-click setup for macOS / Linux — the same three steps
# as the Windows .bat: check magpie, register the plugin, start the
# butler sign-in, then print the connection card.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "============================================"
echo "  muse2api 一键安装 (macOS / Linux)"
echo "============================================"
if ! command -v magpie >/dev/null 2>&1; then
  echo "[需要先装 magpie] 没有找到 magpie 命令。"
  echo "官方一行安装: curl -fsSL https://usemagpie.ai/install.sh | sh"
  echo "或打开 https://usemagpie.ai 下载。装好后重新运行本脚本即可。"
  if command -v open >/dev/null 2>&1; then open https://usemagpie.ai || true;
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open https://usemagpie.ai || true; fi
  read -r -p "按回车关闭…" _ || true
  exit 1
fi
echo "[1/2] 注册插件…"
if ! magpie plugin add "$DIR/muse2api"; then
  echo "插件注册失败，把上面的报错发回来看看。"
  read -r -p "按回车关闭…" _ || true
  exit 1
fi
echo
echo "[2/2] 启动登录: 接下来出现的菜单里，输入 1 再回车"
echo "      (选 Set up muse2api for me，管家托管那一项)"
echo "      然后在弹出的浏览器窗口里登录 muse.ai，其余全自动。"
echo
magpie plugin login muse2api
if [ -f "$HOME/.muse2api-plugin/.env" ]; then
  echo
  echo "[3/3] 这台机器的接入信息:"
  bash "$DIR/show-connection.sh" || true
fi
echo
echo "============================================"
echo "  登录流程结束。验证整条链路: magpie provider test muse2api"
echo "  在 Codex 里开始用:   magpie codex muse2api/muse-spark"
echo "============================================"
read -r -p "按回车关闭…" _ || true
