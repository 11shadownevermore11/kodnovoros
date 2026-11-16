#!/usr/bin/env bash
# Открывает сайт и API в интернет через бесплатный туннель Cloudflare. Сначала запустите ./run.sh.
# Адрес https://....trycloudflare.com вставьте в приложении: «Ещё → Настройки → Подключение к серверу».
cd "$(dirname "$0")"
if ! command -v cloudflared >/dev/null && [ ! -x ./cloudflared ]; then
  echo "Скачиваю cloudflared..."
  curl -L -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x cloudflared
fi
CF=$(command -v cloudflared || echo ./cloudflared)
exec "$CF" tunnel --url http://localhost:8000
