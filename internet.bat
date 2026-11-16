@echo off
chcp 65001 >nul
title Kod Novorossii - internet
rem Открывает сайт и API в интернет через бесплатный туннель Cloudflare (без регистрации).
rem Сначала запустите run.bat, потом этот файл. Адрес вида https://....trycloudflare.com покажется ниже —
rem вставьте его в приложении: «Ещё → Настройки → Подключение к серверу». Работает из любой сети (мобильный интернет тоже).
cd /d "%~dp0"
if not exist cloudflared.exe (
  echo Скачиваю cloudflared...
  curl -L -o cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe || (echo Не удалось скачать & pause & exit /b 1)
)
echo.
echo  Ищите строку с адресом https://...trycloudflare.com — это адрес сервера для телефона и для жюри.
echo.
cloudflared.exe tunnel --url http://localhost:8000
pause
