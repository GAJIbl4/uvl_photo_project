#!/usr/bin/env bash

# Скрипт настройки DNS для доступа к dashboard по доменному имени uvl-photo.local
# Требует прав root для выполнения

set -e

HOSTNAME="uvl-photo"
DOMAIN="uvl-photo.local"
ENV_FILE=".env"

echo "=========================================="
echo "Настройка DNS для dashboard"
echo "Домен: $DOMAIN"
echo "=========================================="

# Проверка прав root
if [ "$EUID" -ne 0 ]; then 
    echo "Ошибка: Скрипт должен быть запущен с правами root (sudo)"
    exit 1
fi

# Определяем директорию проекта
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

echo ""
echo "1. Установка и настройка avahi-daemon..."

# Установка avahi-daemon
if ! command -v avahi-daemon &> /dev/null; then
    echo "   Установка avahi-daemon..."
    apt-get update
    apt-get install -y avahi-daemon avahi-utils
else
    echo "   avahi-daemon уже установлен"
fi

# Включение и запуск avahi-daemon
echo "   Включение avahi-daemon..."
systemctl enable avahi-daemon
systemctl start avahi-daemon

echo ""
echo "2. Настройка hostname..."

# Изменение hostname
CURRENT_HOSTNAME=$(hostname)
if [ "$CURRENT_HOSTNAME" != "$HOSTNAME" ]; then
    echo "   Изменение hostname с '$CURRENT_HOSTNAME' на '$HOSTNAME'..."
    hostnamectl set-hostname "$HOSTNAME"
    
    # Обновление /etc/hosts
    if ! grep -q "127.0.1.1.*$HOSTNAME" /etc/hosts; then
        echo "   Обновление /etc/hosts..."
        # Удаляем старую запись для текущего hostname, если есть
        sed -i "/127.0.1.1.*$CURRENT_HOSTNAME/d" /etc/hosts 2>/dev/null || true
        # Добавляем новую запись
        if ! grep -q "127.0.1.1.*$HOSTNAME" /etc/hosts; then
            echo "127.0.1.1    $HOSTNAME" >> /etc/hosts
        fi
    fi
    echo "   Hostname изменен на '$HOSTNAME'"
else
    echo "   Hostname уже установлен как '$HOSTNAME'"
fi

echo ""
echo "3. Настройка avahi-daemon для публикации домена..."

# Создание конфигурации avahi для нашего домена
AVAHI_SERVICE_DIR="/etc/avahi/services"
mkdir -p "$AVAHI_SERVICE_DIR"

# Создаем файл сервиса для HTTP
cat > "$AVAHI_SERVICE_DIR/dashboard-http.service" <<EOF
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">UVL Photo Dashboard HTTP on %h</name>
  <service>
    <type>_http._tcp</type>
    <port>8080</port>
    <txt-record>path=/</txt-record>
  </service>
</service-group>
EOF

# Создаем файл сервиса для WebSocket
cat > "$AVAHI_SERVICE_DIR/dashboard-ws.service" <<EOF
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">UVL Photo Dashboard WebSocket on %h</name>
  <service>
    <type>_ws._tcp</type>
    <port>8081</port>
  </service>
</service-group>
EOF

echo "   Файлы конфигурации avahi созданы"

# Перезапуск avahi-daemon для применения изменений
echo "   Перезапуск avahi-daemon..."
systemctl restart avahi-daemon

echo ""
echo "4. Установка и настройка nginx..."

# Установка nginx
if ! command -v nginx &> /dev/null; then
    echo "   Установка nginx..."
    apt-get update
    apt-get install -y nginx
else
    echo "   nginx уже установлен"
fi

# Создание конфигурации nginx для dashboard
NGINX_CONF="/etc/nginx/sites-available/uvl-photo-dashboard"
NGINX_ENABLED="/etc/nginx/sites-enabled/uvl-photo-dashboard"

echo "   Создание конфигурации nginx..."

# Создаем конфигурацию nginx
cat > "$NGINX_CONF" <<'NGINX_EOF'
server {
    listen 80;
    server_name uvl-photo.local;

    # Логи
    access_log /var/log/nginx/uvl-photo-dashboard-access.log;
    error_log /var/log/nginx/uvl-photo-dashboard-error.log;

    # Проксирование статических файлов на порт 8080
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Таймауты для WebSocket
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # Проксирование WebSocket на порт 8081
    location /ws {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Таймауты для WebSocket
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
NGINX_EOF

# Создаем симлинк в sites-enabled
if [ -L "$NGINX_ENABLED" ]; then
    echo "   Конфигурация nginx уже включена"
else
    echo "   Включение конфигурации nginx..."
    ln -s "$NGINX_CONF" "$NGINX_ENABLED"
fi

# Проверяем конфигурацию nginx
echo "   Проверка конфигурации nginx..."
if nginx -t 2>/dev/null; then
    echo "   ✓ Конфигурация nginx корректна"
    # Перезапускаем nginx
    echo "   Перезапуск nginx..."
    systemctl enable nginx
    systemctl restart nginx
    echo "   ✓ nginx настроен и запущен"
else
    echo "   ✗ Ошибка в конфигурации nginx"
    echo "   Проверьте конфигурацию: nginx -t"
fi

echo ""
echo "5. Настройка переменной окружения DASHBOARD_HOSTNAME..."

# Проверяем существование .env файла
if [ ! -f "$ENV_FILE" ]; then
    echo "   Создание файла $ENV_FILE..."
    touch "$ENV_FILE"
fi

# Обновляем или добавляем DASHBOARD_HOSTNAME
if grep -q "^DASHBOARD_HOSTNAME=" "$ENV_FILE"; then
    echo "   Обновление DASHBOARD_HOSTNAME в $ENV_FILE..."
    sed -i "s|^DASHBOARD_HOSTNAME=.*|DASHBOARD_HOSTNAME=$DOMAIN|" "$ENV_FILE"
else
    echo "   Добавление DASHBOARD_HOSTNAME в $ENV_FILE..."
    echo "" >> "$ENV_FILE"
    echo "# Доменное имя для доступа к dashboard" >> "$ENV_FILE"
    echo "DASHBOARD_HOSTNAME=$DOMAIN" >> "$ENV_FILE"
fi

echo ""
echo "6. Проверка настройки..."

# Проверка hostname
CURRENT_HOSTNAME=$(hostname)
if [ "$CURRENT_HOSTNAME" = "$HOSTNAME" ]; then
    echo "   ✓ Hostname установлен: $CURRENT_HOSTNAME"
else
    echo "   ✗ Ошибка: Hostname не установлен правильно (текущий: $CURRENT_HOSTNAME)"
fi

# Проверка avahi-daemon
if systemctl is-active --quiet avahi-daemon; then
    echo "   ✓ avahi-daemon запущен"
else
    echo "   ✗ Ошибка: avahi-daemon не запущен"
fi

# Проверка переменной окружения
if grep -q "^DASHBOARD_HOSTNAME=$DOMAIN" "$ENV_FILE"; then
    echo "   ✓ DASHBOARD_HOSTNAME установлен в $ENV_FILE"
else
    echo "   ✗ Ошибка: DASHBOARD_HOSTNAME не установлен в $ENV_FILE"
fi

# Проверка nginx
if systemctl is-active --quiet nginx; then
    echo "   ✓ nginx запущен"
else
    echo "   ✗ Ошибка: nginx не запущен"
fi

echo ""
echo "=========================================="
echo "Настройка завершена!"
echo "=========================================="
echo ""
echo "Dashboard будет доступен по адресу:"
echo "  http://$DOMAIN"
echo ""
echo "Примечание: nginx проксирует запросы на порт 8080 (HTTP) и 8081 (WebSocket)"
echo ""
echo "Для применения изменений перезапустите приложение:"
echo "  sudo systemctl restart offboard"
echo ""
echo "Или если запускаете вручную:"
echo "  node index.js"
echo ""
echo "Примечание: Для работы mDNS на клиентских устройствах:"
echo "  - Windows: Включите службу 'Служба обнаружения SSDP'"
echo "  - macOS/Linux: mDNS обычно работает из коробки"
echo ""

