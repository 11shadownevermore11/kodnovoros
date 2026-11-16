#!/usr/bin/env bash
# Запуск платформы одной командой: API + собранный сайт на http://localhost:8000
set -e
cd "$(dirname "$0")/backend"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt
echo "Сайт: http://localhost:8000   API: http://localhost:8000/docs"
echo "Телефон в той же Wi-Fi: в приложении «Ещё → Настройки → Подключение к серверу» введите http://$(hostname -I 2>/dev/null | awk '{print $1}'):8000"
echo "Через интернет из любой сети: ./internet.sh"
exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
