# uvl-photo-project

Бортовой софт для дрона на Raspberry Pi для фотографирования по нажатию кнопки.

## Установка и запуск

### 1. Установка зависимостей

```bash
npm install
```

### 2. Создание файла конфигурации .env

#### Вариант A: Использование скрипта (Linux/Mac)

```bash
chmod +x tools/generate_env.sh
./tools/generate_env.sh > .env
```

#### Вариант B: Ручное создание (Windows/Linux/Mac)

Скопируйте пример конфигурации:

```bash
cp .env.example .env
```

Затем отредактируйте файл `.env` под вашу систему.

### 3. Настройка .env файла

Минимальные настройки для работы:

```env
# Включить камеру
CAMERA_EN=true

# Путь к последовательному порту MAVLink
MAVLINK_SERIAL_PATH=/dev/ttyACM0

# Путь к последовательному порту OSD
OSD_SERIAL_PATH=/dev/ttyAMA0

# RC канал для кнопки фотографирования
RC_PHOTO_CH=7
RC_PHOTO_PWM=2006
```

### 4. Запуск системы

```bash
node index.js
```

Или если файл исполняемый:

```bash
./index.js
```

## Настройка RC каналов

### Кнопка фотографирования (RC Channel 7)

```
RC_PHOTO_CH=7
RC_PHOTO_PWM=2006  # Значение PWM при нажатии кнопки
```

При нажатии кнопки на канале 7 с PWM значением 2006 система сделает фотографию.

## Настройки камеры

Основные параметры камеры в `.env`:

```env
CAMERA_EN=true                    # Включить камеру
PHOTO_WIDTH=2028                  # Ширина фотографии (пиксели)
PHOTO_HEIGHT=1520                 # Высота фотографии (пиксели)
PHOTO_EXIF_ORIENTATION=6          # Ориентация EXIF (1-8)
CAMERA_TIMEOUT=0                  # Таймаут камеры (0 = бесконечно, мс)
CAMERA_FRAMERATE=10               # Частота кадров
```

## Веб-интерфейс

После запуска системы доступен веб-интерфейс:

- **HTTP**: http://localhost:8080 (статические файлы)
- **WebSocket**: ws://localhost:8081 (двусторонняя связь)

### Настройка доступа по доменному имени

Для доступа к dashboard по доменному имени `uvl-photo.local` вместо IP адреса:

**Вариант 1 (рекомендуется):** При установке с правами root скрипт настройки DNS запустится автоматически:
```bash
sudo npm install
```

**Вариант 2:** Запустите настройку DNS вручную:
```bash
sudo npm run setup-dns
```

**Вариант 3:** Запустите скрипт напрямую:
```bash
sudo ./tools/setup-dns.sh
```

После настройки dashboard будет доступен по адресу: `http://uvl-photo.local:8080`

Подробная документация: [docs/ru/dashboard-url.md](docs/ru/dashboard-url.md)

## Структура проекта

- `index.js` - главный файл приложения
- `photo.js` - модуль фотографирования
- `camera.js` - обёртка над libcamera-vid
- `mavlink/` - работа с протоколом MAVLink
- `dashboard-public/` - веб-интерфейс

## Требования

- Node.js
- Raspberry Pi с камерой
- libcamera-vid (обычно предустановлен на Raspberry Pi OS)
- Полётный контроллер с поддержкой MAVLink
