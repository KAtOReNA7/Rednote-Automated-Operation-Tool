@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Rednote Web FSA 用户验收
echo 正在启动只绑定 127.0.0.1 的本地验收页面……
node scripts\start-web-fsa-smoke.mjs
if errorlevel 1 (
  echo.
  echo 启动失败，请把本窗口中的稳定错误码发给 Codex。
  pause
)
