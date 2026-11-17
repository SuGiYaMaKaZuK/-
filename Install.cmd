@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
set "CARD_REVEAL_INSTALL_EXIT=%ERRORLEVEL%"
echo.
if not "%CARD_REVEAL_INSTALL_EXIT%"=="0" echo Installation failed. See the message above.
pause
exit /b %CARD_REVEAL_INSTALL_EXIT%
