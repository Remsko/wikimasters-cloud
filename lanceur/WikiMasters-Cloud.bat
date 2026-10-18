@echo off
title WikiMasters Cloud
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0WikiMasters-Cloud.ps1" %*
if errorlevel 1 pause
