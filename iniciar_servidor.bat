@echo off
title Microlins Potirendaba - Servidor Local
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar_servidor.ps1"
pause
