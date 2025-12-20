# Установка systemd сервиса для uvl-photo-project

Этот сервис обеспечивает автоматический запуск `index.js` при старте системы Raspberry Pi.

## Быстрая установка

```bash
sudo bash systemd/install-uvl-photo-service.sh
```

Скрипт установки автоматически:
- Делает скрипт-обертку исполняемым
- Обновляет путь к проекту в файле сервиса
- Копирует файл сервиса в `/etc/systemd/system`
- Перезагружает systemd
- Включает автозапуск сервиса

## Ручная установка

Если вы хотите установить сервис вручную:

1. Сделайте скрипт-обертку исполняемым:
```bash
chmod +x systemd/uvl-photo.service.sh
```

2. Отредактируйте путь к проекту в `systemd/uvl-photo.service`:
   - Замените `/home/pi/uvl_photo_project` на актуальный путь к вашему проекту

3. Скопируйте файл сервиса:
```bash
sudo cp systemd/uvl-photo.service /etc/systemd/system/
```

4. Перезагрузите systemd:
```bash
sudo systemctl daemon-reload
```

5. Включите автозапуск:
```bash
sudo systemctl enable uvl-photo.service
```

6. Запустите сервис:
```bash
sudo systemctl start uvl-photo.service
```

## Управление сервисом

### Запуск
```bash
sudo systemctl start uvl-photo.service
```

### Остановка
```bash
sudo systemctl stop uvl-photo.service
```

### Перезапуск
```bash
sudo systemctl restart uvl-photo.service
```

### Проверка статуса
```bash
sudo systemctl status uvl-photo.service
```

### Просмотр логов
```bash
# Логи в реальном времени
sudo journalctl -u uvl-photo.service -f

# Последние 100 строк логов
sudo journalctl -u uvl-photo.service -n 100

# Логи с определенного времени
sudo journalctl -u uvl-photo.service --since "2024-01-01 00:00:00"
```

### Отключение автозапуска
```bash
sudo systemctl disable uvl-photo.service
```

## Настройка

Сервис автоматически загружает переменные окружения из файла `.env` в корне проекта.

Убедитесь, что файл `.env` существует и содержит все необходимые переменные окружения.

## Поведение сервиса

- **Автозапуск**: Сервис запускается автоматически при загрузке системы
- **Автоперезапуск**: Если процесс завершится с ошибкой, systemd автоматически перезапустит его через 5 секунд
- **Зависимости**: Сервис ждет доступности сети перед запуском
- **Пользователь**: Сервис запускается от имени пользователя `pi`

## Устранение неполадок

### Сервис не запускается

1. Проверьте статус:
```bash
sudo systemctl status uvl-photo.service
```

2. Проверьте логи:
```bash
sudo journalctl -u uvl-photo.service -n 50
```

3. Убедитесь, что путь к проекту в файле сервиса правильный

4. Убедитесь, что скрипт-обертка исполняемый:
```bash
ls -l systemd/uvl-photo.service.sh
```

### Сервис постоянно перезапускается

Проверьте логи для выявления ошибок:
```bash
sudo journalctl -u uvl-photo.service -n 100
```

Возможные причины:
- Ошибки в коде
- Отсутствие необходимых переменных окружения
- Проблемы с доступом к последовательным портам
- Проблемы с правами доступа

### Изменение пути к проекту

Если вы переместили проект в другое место:

1. Отредактируйте файл сервиса:
```bash
sudo nano /etc/systemd/system/uvl-photo.service
```

2. Обновите пути в строках `ExecStart` и `WorkingDirectory`

3. Перезагрузите systemd:
```bash
sudo systemctl daemon-reload
```

4. Перезапустите сервис:
```bash
sudo systemctl restart uvl-photo.service
```

