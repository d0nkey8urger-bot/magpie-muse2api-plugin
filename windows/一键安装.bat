@echo off
title muse2api 一键安装（magpie 插件）
cd /d "%~dp0"
echo ============================================
echo   muse2api 一键安装
echo   依次完成: 注册插件 - 启动管家登录
echo ============================================
echo.
where magpie >nul 2>nul
if not errorlevel 1 goto HaveMagpie
echo [需要先装 magpie] 没有找到 magpie 命令。
echo 正在为你打开 magpie 官网，装好后重新双击本文件即可。
start https://usemagpie.ai
goto End
:HaveMagpie
echo [1/2] 注册插件...
magpie plugin add "%~dp0muse2api"
if not errorlevel 1 goto AddOk
echo 插件注册失败，把上面的报错发回来看看。
goto End
:AddOk
echo.
echo [2/2] 启动登录: 接下来出现的菜单里，输入 1 再回车
echo       (选 Set up muse2api for me，管家托管那一项)
echo       然后在弹出的 Chrome 窗口里登录 muse.ai，其余全自动。
echo.
magpie plugin login muse2api
if not exist "%USERPROFILE%\.muse2api-plugin\.env" goto NoCard
echo.
echo [3/3] 这台机器的接入信息:
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0show-connection.ps1"
:NoCard
echo.
echo ============================================
echo   登录流程结束。验证整条链路:
echo     magpie provider test muse2api
echo   在 Codex 里开始用:
echo     magpie codex muse2api/muse-spark
echo ============================================
:End
pause
