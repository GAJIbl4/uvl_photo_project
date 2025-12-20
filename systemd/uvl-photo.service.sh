#!/usr/bin/env bash

# Переходим в директорию проекта
cd "$(dirname "$BASH_SOURCE")/.." || {
  echo "Ошибка: не удалось перейти в директорию проекта" >&2
  exit 1
}

# Загружаем переменные окружения из .env файла
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Проверяем наличие Node.js
if ! command -v node &> /dev/null; then
  echo "Ошибка: Node.js не найден" >&2
  exit 1
fi

# Запускаем приложение
exec node index.js

