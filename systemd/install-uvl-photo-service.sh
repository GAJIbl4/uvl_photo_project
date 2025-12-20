#!/usr/bin/env bash

# Скрипт установки systemd сервиса для uvl-photo-project

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVICE_NAME="uvl-photo.service"
SERVICE_FILE="$SCRIPT_DIR/$SERVICE_NAME"
SYSTEMD_DIR="/etc/systemd/system"

echo "Установка сервиса $SERVICE_NAME..."

# Проверяем, что скрипт запущен от root
if [ "$EUID" -ne 0 ]; then 
  echo "Ошибка: скрипт должен быть запущен с правами root (используйте sudo)"
  exit 1
fi

# Делаем скрипт-обертку исполняемым
chmod +x "$SCRIPT_DIR/uvl-photo.service.sh"

# Создаем временную копию файла сервиса
TEMP_SERVICE_FILE=$(mktemp)
cp "$SERVICE_FILE" "$TEMP_SERVICE_FILE"

# Обновляем путь к проекту в временной копии
# Заменяем /home/pi/uvl_photo_project на актуальный путь
sed -i "s|/home/pi/uvl_photo_project|$PROJECT_DIR|g" "$TEMP_SERVICE_FILE"

# Копируем обновленный файл сервиса в systemd
cp "$TEMP_SERVICE_FILE" "$SYSTEMD_DIR/$SERVICE_NAME"

# Удаляем временный файл
rm "$TEMP_SERVICE_FILE"

# Перезагружаем systemd
systemctl daemon-reload

# Включаем автозапуск
systemctl enable "$SERVICE_NAME"

echo "Сервис $SERVICE_NAME успешно установлен и включен для автозапуска."
echo ""
echo "Для управления сервисом используйте:"
echo "  sudo systemctl start $SERVICE_NAME    # Запустить сервис"
echo "  sudo systemctl stop $SERVICE_NAME     # Остановить сервис"
echo "  sudo systemctl restart $SERVICE_NAME  # Перезапустить сервис"
echo "  sudo systemctl status $SERVICE_NAME   # Проверить статус"
echo "  sudo systemctl disable $SERVICE_NAME  # Отключить автозапуск"
echo "  sudo journalctl -u $SERVICE_NAME -f  # Просмотр логов в реальном времени"

