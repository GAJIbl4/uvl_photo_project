# uvl_photo_project

Система автоматического фотографирования для Raspberry Pi Zero 2W с камерой Arducam Mini HQ IMX477 и полётным контроллером Ardupilot.

## Описание

Проект позволяет делать фотографии по команде с полётного контроллера Ardupilot через RC канал. Система слушает RC6 канал и при превышении порогового значения делает фотографию, сохраняя её с порядковым номером в указанной папке.

## Возможности

- 📸 Автоматическое фотографирование по команде с RC6 канала
- 🎛️ Гибкие настройки камеры (разрешение, выдержка, ISO, баланс белого и др.)
- 📡 Связь с Ardupilot через MAVLink протокол
- 📊 Обратная связь на OSD (статус системы, количество фотографий, ошибки)
- 💾 Автоматическая нумерация фотографий с сохранением счётчика
- ⚙️ Централизованная конфигурация в config.js

## Требования

- Raspberry Pi Zero 2W (или совместимая модель)
- Arducam Mini HQ IMX477 камера
- Полётный контроллер с Ardupilot
- USB соединение между Raspberry Pi и полётным контроллером
- Node.js 18+ (или последняя LTS версия)
- Установленные драйвера для камеры Arducam

## Установка

### На Raspberry Pi

1. Клонируйте репозиторий или скопируйте файлы проекта:
```bash
git clone <repository_url>
cd uvl_photo_project
```

2. Установите Node.js (если ещё не установлен):
```bash
# Для Raspberry Pi OS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Или используйте nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20
```

3. Установите зависимости:
```bash
npm install
```

**КРИТИЧЕСКИ ВАЖНО:** Для работы проекта необходимо скопировать MAVLink библиотеку из исходного проекта:

1. **Создайте папку `third_party`** (если её нет):
   ```bash
   mkdir third_party
   ```

2. **Скопируйте файл `MAVLink20Next.js`** из исходного проекта:
   - Из: `C:\Users\user\Downloads\uvl-inventory-offboard-main\uvl-inventory-offboard-main\third_party\MAVLink20Next.js`
   - В: `C:\GitHub\uvl_photo_project\third_party\MAVLink20Next.js`
   
   Или используйте команду (в PowerShell):
   ```powershell
   Copy-Item "C:\Users\user\Downloads\uvl-inventory-offboard-main\uvl-inventory-offboard-main\third_party\MAVLink20Next.js" -Destination "third_party\MAVLink20Next.js"
   ```

3. **Установите зависимости**:
   ```bash
   npm install
   ```

**Проект теперь использует правильный MAVLink парсер из исходного проекта**, который корректно обрабатывает RC_CHANNELS и другие сообщения. Также используется правильная обработка OSD из исходного проекта.

4. Настройте конфигурацию в файле `config.js`:
   - Путь к папке для фотографий (`PHOTOS_DIR`)
   - Параметры подключения к полётному контроллеру (`MAVLINK_CONFIG` - порт, скорость)
   - Настройки камеры (`CAMERA_CONFIG` - разрешение, выдержка, ISO и т.д.)
   - Параметры RC канала для триггера (`RC_CHANNEL`, `RC_THRESHOLD`)
   - Настройки OSD (`OSD_CONFIG` - порт, скорость, геометрия)

5. Убедитесь, что камера подключена и драйвера установлены:
```bash
libcamera-hello --list-cameras
```

6. Установите и запустите systemd сервис:
```bash
# Скопируйте файл сервиса
sudo cp uvl-photo.service /etc/systemd/system/

# Отредактируйте путь к проекту, если необходимо
sudo nano /etc/systemd/system/uvl-photo.service

# Перезагрузите systemd
sudo systemctl daemon-reload

# Включите автозапуск
sudo systemctl enable uvl-photo.service

# Запустите сервис
sudo systemctl start uvl-photo.service

# Проверьте статус
sudo systemctl status uvl-photo.service
```

## Использование

### Запуск вручную

```bash
npm start
# или
node index.js
```

### Управление демоном

```bash
# Запуск
sudo systemctl start uvl-photo.service

# Остановка
sudo systemctl stop uvl-photo.service

# Перезапуск
sudo systemctl restart uvl-photo.service

# Просмотр логов
sudo journalctl -u uvl-photo.service -f

# Просмотр статуса
sudo systemctl status uvl-photo.service
```

## Конфигурация

Основные настройки находятся в файле `config.js`:

### Настройки папки для фотографий
```javascript
export const PHOTOS_DIR = '/home/pi/photos';
```

### Настройки MAVLink
```javascript
export const MAVLINK_CONFIG = {
  port: '/dev/ttyACM0',  // USB порт
  baudrate: 2000000,     // Скорость передачи
};
```

### Настройки RC канала
```javascript
export const RC_CHANNEL = 6;        // Номер канала для триггера
export const RC_THRESHOLD = 1500;   // Пороговое значение PWM
```

### Настройки камеры
```javascript
export const CAMERA_CONFIG = {
  resolution: [4056, 3040],  // Разрешение
  shutterSpeed: 0,            // Выдержка (0 = авто)
  iso: 0,                     // ISO (0 = авто)
  exposureMode: 'auto',        // Режим экспозиции
  awbMode: 'auto',            // Баланс белого
  jpegQuality: 95,            // Качество JPEG
  // ... и другие параметры
};
```

### Настройки OSD
```javascript
export const OSD_CONFIG = {
  enabled: true,
  port: '/dev/ttyAMA0',
  baudrate: 115200,
  width: 30,
  height: 16,
  // ... и другие параметры
};
```

## Структура проекта

```
uvl_photo_project/
├── index.js              # Основной скрипт
├── config.js             # Конфигурационный файл
├── mavlink-handler.js    # Модуль работы с MAVLink
├── camera-handler.js     # Модуль работы с камерой
├── osd-handler.js        # Модуль работы с OSD
├── osd.js                # OSD рендерер
├── feedback-handler.js   # Модуль обратной связи для OSD
├── package.json          # Зависимости Node.js
├── uvl-photo.service    # Systemd service файл
└── README.md             # Документация
```

## Обратная связь на OSD

Система отправляет статусную информацию на полётный контроллер для отображения на OSD:
- Статус подключения MAVLink
- Статус камеры
- Количество сделанных фотографий
- Имя последнего файла
- Сообщения об ошибках

## Логирование

Логи сохраняются в файл `/home/pi/photo_project.log` и выводятся в консоль.

Уровень логирования настраивается в `config.js`:
- `debug` - подробная отладочная информация
- `info` - информационные сообщения (по умолчанию)
- `warn` - предупреждения
- `error` - только ошибки

## Устранение неполадок

### Камера не инициализируется
- Проверьте подключение камеры
- Убедитесь, что драйвера установлены: `libcamera-hello --list-cameras`
- Проверьте права доступа к устройству камеры
- Убедитесь, что пользователь в группе `video`: `sudo usermod -a -G video pi`

### Нет подключения к полётному контроллеру
- Проверьте USB соединение
- Убедитесь, что порт указан правильно: `ls /dev/ttyACM*`
- Проверьте скорость передачи данных (baudrate)
- Убедитесь, что полётный контроллер включен и работает
- Убедитесь, что пользователь в группе `dialout`: `sudo usermod -a -G dialout pi`
- После добавления в группы перелогиньтесь или перезагрузите систему

### RC канал не срабатывает
- Проверьте номер канала в конфигурации
- Убедитесь, что пороговое значение (RC_THRESHOLD) установлено правильно
- Проверьте, что канал действительно передаёт данные (можно посмотреть в логах)

### OSD не отображается
- Проверьте подключение к последовательному порту OSD
- Убедитесь, что порт указан правильно в `OSD_CONFIG`: `ls /dev/ttyAMA*`
- Проверьте, что параметр `OSD1_UIOSD_EN` установлен в `1` на полётном контроллере
- Проверьте логи: `sudo journalctl -u uvl-photo.service -f`

### Проблемы с правами доступа
```bash
# Добавить пользователя в необходимые группы
sudo usermod -a -G dialout,video pi

# Перелогиниться или перезагрузиться
# После этого проверить группы:
groups
```

### Проблемы с Node.js
```bash
# Проверить версию Node.js
node --version  # Должна быть 18+

# Переустановить зависимости
rm -rf node_modules package-lock.json
npm install
```

### Проблемы с MAVLink
Текущая версия использует упрощённый MAVLink парсер. Для полноценной работы:
1. Скопируйте `MAVLink20Next.js` из исходного проекта `uvl-inventory-offboard` в папку `third_party/`
2. Создайте модули `mavlink/impl.js` и `mavlink/system.js` по аналогии с исходным проектом
3. Обновите `mavlink-handler.js` для использования полноценного парсера

Альтернативно можно использовать другие MAVLink библиотеки для Node.js, если они доступны.

## Автор

Проект создан для автоматизации фотографирования с дрона.

## Лицензия

[Укажите лицензию при необходимости]
