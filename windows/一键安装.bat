@echo off
title muse2api 傻瓜版一键安装
cd /d "%~dp0"
echo ============================================
echo   muse2api 傻瓜版一键安装
echo   不需要 magpie: 装好实例 - 弹窗登录 - 打印接入信息
echo ============================================
echo.
py -3 --version >nul 2>nul
if not errorlevel 1 goto RunPy
python --version >nul 2>nul
if not errorlevel 1 goto RunPython
echo [需要 Python] 没有找到 Python 3.10+。
echo 正在为你打开 Python 官网，装好后重新双击本文件即可。
echo (安装时记得勾选 Add python.exe to PATH)
start https://www.python.org/downloads/
goto End
:RunPy
py -3 "%~dp0muse2api-setup.py"
goto End
:RunPython
python "%~dp0muse2api-setup.py"
:End
pause
