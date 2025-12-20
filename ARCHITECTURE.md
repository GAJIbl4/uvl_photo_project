# Архитектура проекта uvl-inventory-offboard

## Обзор

Бортовой софт для дрона на базе Raspberry Pi, который:
- Устанавливает связь с полётным контроллером через MAVLink (последовательный порт)
- Парсит каналы управления дрона (RC channels)
- Принимает информацию от сканера через последовательный порт
- Отправляет OSD (On-Screen Display) на полётный контроллер через последовательный порт
- Управляет Python модулем инвентаризации через протокол mintt (TCP)

## ⚠️ Важное правило работы с проектом

**При работе над проектом необходимо:**

1. **Ориентироваться на файл `ARCHITECTURE_LLM.json`** как на основной справочник по архитектуре проекта
2. **При каждом изменении архитектуры, добавлении новых модулей, функций или переменных** - обязательно обновлять `ARCHITECTURE_LLM.json`
3. **Файл `ARCHITECTURE_LLM.json`** используется LLM-ассистентами для понимания структуры проекта без необходимости анализа всего кода
4. **Файл `ARCHITECTURE.md`** предназначен для людей и содержит более подробные описания и схемы

Это правило обеспечивает актуальность документации и позволяет LLM-ассистентам эффективно работать с проектом.

## Точка входа

**index.js** - главный файл приложения, инициализирует все компоненты и координирует их работу.

## Архитектурная схема

```
┌─────────────────────────────────────────────────────────────────┐
│                         Raspberry Pi                             │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    index.js (главный)                     │  │
│  └────────────┬───────────────────────────────┬─────────────┘  │
│               │                                 │                 │
│    ┌──────────▼──────────┐        ┌────────────▼──────────┐     │
│    │   MAVLink System    │        │   Protocol (mintt)    │     │
│    │   (mavlink/)        │        │   (protocol.js)       │     │
│    └──────────┬──────────┘        └────────────┬──────────┘     │
│               │                                 │                 │
│    ┌──────────▼──────────┐        ┌────────────▼──────────┐     │
│    │  Serial Port        │        │  TCP Server           │     │
│    │  /dev/ttyACM0       │        │  Port 55757           │     │
│    │  (MAVLink)          │        │  (Python модуль)       │     │
│    └─────────────────────┘        └───────────────────────┘     │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Serial Port /dev/ttyAMA0 (Scanner + OSD)                │  │
│  │  ┌──────────────┐              ┌──────────────┐         │  │
│  │  │   Scanner    │              │     OSD      │         │  │
│  │  │  (входящий)  │              │  (исходящий) │         │  │
│  │  └──────────────┘              └──────────────┘         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Dashboard (HTTP:8080, WebSocket:8081)                  │  │
│  │  - Веб-интерфейс для мониторинга                         │  │
│  │  - Управление складом и аллеями                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Camera (libcamera-vid)                                  │  │
│  │  - Съёмка фотографий для инвентаризации                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
    Полётный           Python модуль         Сканер штрих-
    контроллер         инвентаризации        кодов
    (MAVLink)          (mintt TCP)          (Serial)
```

## Структура файлов и модулей

### 1. index.js (главный файл)

**Назначение**: Точка входа приложения, инициализация всех компонентов.

**Основные переменные:**
- `droneId` - ID дрона из переменных окружения
- `current` - текущее состояние (alley_name, pilot_name)
- `mavlinkSerialPath`, `mavlinkSerialBaud` - параметры последовательного порта для MAVLink
- `scannerPath`, `scannerBaud` - параметры последовательного порта для сканера
- `osdPath`, `osdBaud` - параметры последовательного порта для OSD
- `mavlinkUdpEn`, `mavlinkUdpHost`, `mavlinkUdpPort` - параметры UDP для MAVLink
- `rcEmptyCh`, `rcRescanCh`, `rcNoTagCh`, `rcUnreadableCh`, `rcPhotoCh`, `rcScanoffCh`, `rcAlleySwitchCh` - номера RC каналов
- `rcEmptyPwm`, `rcRescanPwm`, `rcNoTagPwm`, `rcUnreadablePwm`, `rcPhotoPwm`, `rcScanoffPwm`, `rcAlleyNextPwm`, `rcAlleyPrevPwm` - значения PWM для кнопок
- `realsensepyEn`, `realsensepyUdpHost`, `realsensepyUdpPort` - параметры для RealSense
- `copterSoftEn` - включение модуля CopterSoft
- `takePhotoRequestId` - ID текущего запроса на фото

**Основные функции:**
- `getIp()` - получение IP адреса интерфейса wlan0
- `connectionStatus()` - определение статуса подключения (лицензия, MAVLink, IP, протокол)
- `handleButton(label)` - обработка нажатий кнопок
- `showInfoMessage(data, duration)` - отображение информационного сообщения на OSD
- `onOSDConnected()` - обработчик подключения OSD
- `nextAlleyName(currName, offset)` - получение следующего/предыдущего имени аллеи
- `loadExistingOrNewAlley(alley, pilot)` - загрузка существующей или создание новой аллеи
- `nextAlley()`, `prevAlley()` - переключение между аллеями

**Потоки данных:**
1. **Сканер → Протокол**: Данные со сканера отправляются в Python модуль через `protocol.send('barcode', buff)`
2. **RC Channels → Кнопки**: Каналы управления парсятся и преобразуются в действия кнопок
3. **Протокол → OSD**: Команды от Python модуля отображаются на OSD
4. **MAVLink → Статус**: Heartbeat от полётного контроллера используется для определения статуса подключения

### 2. mavlink/ (модуль MAVLink)

#### 2.1. mavlink/system.js

**Назначение**: Основной класс для работы с MAVLink протоколом.

**Класс: MavSystem extends EventEmitter**

**Основные свойства:**
- `id` - ID системы MAVLink
- `componentId` - ID компонента (MAV_COMP_ID_ONBOARD_COMPUTER)
- `sendEnabled` - флаг разрешения отправки сообщений
- `requestedMessages` - объект с запрашиваемыми сообщениями и их частотами

**Основные методы:**
- `send(msg, from)` - отправка MAVLink сообщения
- `connect(what)` - создание адаптера для подключения внешних систем
- `subscribeTo(name, freq, transform)` - подписка на MAVLink сообщение
- `setMessageInterval(name, freq)` - установка интервала отправки сообщения
- `getMission()` - получение миссии с полётного контроллера
- `setMission(mission, doublecheck)` - установка миссии на полётный контроллер
- `clearMission()` - очистка миссии
- `commandInt(frame, cmd, ...args)` - отправка команды COMMAND_INT
- `commandLong(cmd, ...args)` - отправка команды COMMAND_LONG
- `arm()`, `disarm()`, `forceArm()`, `forceDisarm()` - управление арматурой
- `takeOff(altitude)` - взлёт на заданную высоту
- `land()` - посадка
- `flyto(lon, lat, alt, accuracy, accuracy_alt)` - полёт к точке
- `setYaw(yaw_deg)` - установка курса
- `heartbeat()` - отправка heartbeat сообщения
- `setApmMode(main_mode)` - установка режима ArduPilot
- `guided()` - переход в режим GUIDED

**События:**
- `heartbeat` - получен heartbeat от полётного контроллера
- `rc_channels` - получены данные RC каналов
- `message` - получено любое MAVLink сообщение
- `messageToFlightController` - сообщение отправлено полётному контроллеру

#### 2.2. mavlink/impl.js

**Назначение**: Реализация парсинга и обработки MAVLink сообщений.

**Основные экспорты:**
- `mav2` - объект с константами и сообщениями MAVLink 2.0
- `MAVLink20Processor` - класс для обработки MAVLink 2.0 сообщений
- `parse(parser, buff, onmsg, onbad)` - функция парсинга буфера MAVLink сообщений
- `apm` - константы режимов ArduPilot

**Вспомогательные функции:**
- `process_HEARTBEAT(msg)` - обработка heartbeat сообщения
- `process_SYS_STATUS(msg)` - обработка статуса системы
- `process_EXTENDED_SYS_STATE(msg)` - обработка расширенного статуса системы

#### 2.3. mavlink/mission.js

**Назначение**: Работа с миссиями MAVLink.

**Класс: MavMissionItem**
- Представляет один элемент миссии
- Методы: `fromMavMessage()`, `fromQGCPlanItem()`, `mavMessage()`, `fromPoint()`, `isEqual()`

**Класс: MavMission**
- Представляет полную миссию
- Методы: `fromMavMessages()`, `fromQGCPlan()`, `toJSON()`, `mavMessages()`, `fromPoints()`, `asCoordinates()`, `isEqual()`

#### 2.4. mavlink/geo.js

**Назначение**: Географические вычисления.

**Функции:**
- `global_distance(lon1, lat1, lon2, lat2)` - вычисление расстояния между двумя точками (формула гаверсинуса)
- `find_closest(target, points, max_dist)` - поиск ближайшей точки
- `destination(lon, lat, Δlon, Δlat)` - вычисление точки назначения по смещению

#### 2.5. mavlink/index.js

**Назначение**: Экспорт всех модулей MAVLink.

### 3. protocol.js

**Назначение**: Протокол связи с Python модулем инвентаризации (mintt).

**Класс: Protocol extends EventEmitter**

**Основные методы:**
- `send(topic, params, data)` - отправка сообщения всем подключённым клиентам
- `hasConnections()` - проверка наличия подключённых клиентов

**Формат сообщения:**
```
mintt:topic?param1=value1&param2=value2\r\n
[body data]
```

**События:**
- `clientConnected` - подключён новый клиент
- `message` - получено сообщение
- `[topic]` - событие с именем топика сообщения

**Основные топики:**
- `barcode` - данные со сканера
- `button` - нажатие кнопки
- `photo` - фотография
- `load_alley` - загрузка аллеи
- `goto` - команда перемещения
- `osd_pallet` - данные о паллетах для OSD
- `osd_scan_status` - статус сканирования для OSD
- `osd_info` - информационное сообщение для OSD
- `osd_draw` - команда рисования на OSD
- `take_photo` - запрос на съёмку фото
- `table_json` - JSON таблицы инвентаризации
- `refresh_state` - обновление состояния

### 4. dashboard.js

**Назначение**: Веб-интерфейс для мониторинга и управления.

**Класс: Dashboard extends EventEmitter**

**Сервисы:**
- HTTP сервер на порту 8080 - статические файлы из `dashboard-public/`
- WebSocket сервер на порту 8081 - двусторонняя связь с клиентами

**Основные методы:**
- `setState(path, value)` - установка состояния (поддерживает lodash пути)
- `log(type, ...args)` - логирование в дашборд

**События:**
- `warehouseJson` - загрузка JSON склада
- `getSavedResults` - запрос сохранённых результатов
- `loadAlley` - загрузка аллеи
- `goto` - команда перемещения
- `timestamp` - установка временной метки
- `downloadCopterSoftReport` - скачивание отчёта
- `deleteAllCopterSoftReports` - удаление всех отчётов
- `loadAlleyFromFile` - загрузка аллеи из файла

**Формат WebSocket сообщений:**
- `ping` → `pong`
- `state:...` - отправка состояния клиенту
- `[event]:[payload]` - событие с данными

### 5. osd.js

**Назначение**: Рендеринг OSD (On-Screen Display) для отправки на полётный контроллер.

**Основные функции:**
- `renderElement(elem, y, x, text)` - рендеринг одного элемента OSD
- `renderElements(elems)` - рендеринг массива элементов
- `posX(x, str)` - вычисление X координаты (поддержка 'left', 'right', 'center', числа)
- `posY(y, str)` - вычисление Y координаты (поддержка 'top', 'bottom', 'center', числа)
- `setGeometry(opt)` - установка геометрии экрана OSD

**Объект: ch**
- Содержит коды специальных символов для OSD (стрелки, рамки, галочки, крестики, паллеты и т.д.)

**Геометрия:**
- `width`, `height` - размеры экрана OSD
- `paddingTop`, `paddingBottom`, `paddingRight`, `paddingLeft` - отступы

**Формат элемента OSD:**
```
[0x55, 0x49, elem, y, x, length, ...data]
```

### 6. ui.js

**Назначение**: Управление UI элементами OSD.

**Основные функции:**
- `configure(write, geometry)` - настройка функции записи и геометрии
- `updateLayout(elems, doRender)` - обновление макета элементов
- `update(elem, ...state)` - обновление состояния элемента
- `render()` - рендеринг всех элементов (с debounce 100ms)

**Механизм работы:**
1. Элементы регистрируются через `updateLayout()` с функцией рендеринга
2. Состояние обновляется через `update()`
3. Рендеринг происходит автоматически с debounce
4. Изменения отправляются через функцию `write` (обычно `osdSp.write`)

**Поддерживаемые элементы:**
- `logo` - логотип
- `name` - имя дрона
- `connection` - статус подключения
- `barcode` - штрих-код
- `infoMessage` - информационное сообщение
- `palletMap` - карта паллет
- `scanStatusOk`, `scanStatusNo` - статус сканирования
- `button` - нажатая кнопка
- И другие...

### 7. photo.js

**Назначение**: Управление камерой и съёмка фотографий.

**Основные переменные:**
- `photoWidth`, `photoHeight` - размеры фотографии
- `photoExifOrientation` - ориентация EXIF

**Функции:**
- `takePhoto(id, callback)` - съёмка фотографии
  - Использует `LibcameravidJPEGStream` из `camera.js`
  - Применяет EXIF поворот через `piexifjs`
  - Вызывает callback с данными JPEG или ошибкой

### 8. camera.js

**Назначение**: Обёртка над libcamera-vid для работы с камерой Raspberry Pi.

**Функции:**
- `Libcameravid(options, errorCb)` - запуск libcamera-vid процесса
- `LibcameravidJPEGStream(options, errorCb)` - поток JPEG кадров из libcamera-vid

**Параметры:**
- `width`, `height` - разрешение
- `timeout` - таймаут (0 = бесконечно)
- `framerate` - частота кадров
- `codec` - кодек ('MJPEG')

### 9. rc.js

**Назначение**: Обработка RC (Radio Control) каналов.

**Функции:**
- `checkButton(msg, ch, ideal, label, cbOn, cbOff)` - проверка нажатия кнопки на RC канале
  - `msg` - сообщение RC_CHANNELS
  - `ch` - номер канала
  - `ideal` - идеальное значение PWM
  - `label` - метка кнопки
  - `cbOn` - callback при нажатии
  - `cbOff` - callback при отпускании

**Механизм:**
- Использует debounce (5 последних значений)
- Проверяет, что значение находится в диапазоне ±5 от идеального
- Вызывает callback только при изменении состояния

**Свойство:**
- `checkButton.debounce = 5` - количество значений для debounce

### 10. adapters.js

**Назначение**: Адаптеры для подключения внешних систем.

**Функции:**
- `udp(host, port, connected)` - создание UDP адаптера
  - Возвращает функцию `send(buff)` для отправки
  - Принимает функцию `recv(buff)` для получения
  - Вызывает `connected(address, twoWay)` при установлении связи
- `connect(adapter1, adapter2)` - соединение двух адаптеров
- `connectSync(adapter1, adapter2)` - синхронное соединение адаптеров

**Использование:**
- Подключение MAVLink через UDP
- Подключение RealSense через UDP

### 11. utils.js

**Назначение**: Вспомогательные утилиты.

**Функции:**
- `log(arg, ...args)` - логирование (можно отключить через `log.off`)
- `parseJson(data)` - безопасный парсинг JSON
- `paseUrl(urlStr)` - парсинг URL
- `shallowEqual(objA, objB)` - поверхностное сравнение объектов
- `shallowEqualAll(all1, all2)` - сравнение массивов объектов
- `once(emitter, event, check, transform)` - ожидание одного события (возвращает CancelablePromise)
- `subscribe(emitter, event, func, ...morelisteners)` - подписка на события
- `repeatRetryUntilTimeout(repeat, until, timeout, retryLimit)` - повтор с таймаутом
- `debounce(func, ms, trailing)` - debounce функция
- `unbitmap_k(value, bitmap)` - извлечение ключей из битовой маски
- `unbitmap_v(value, bitmap)` - извлечение значений из битовой маски
- `paramsJoin(...paramsObjs)` - объединение параметров в query string
- `getFiles(dir, acc)` - рекурсивное получение списка файлов
- `fsExists(filename)` - проверка существования файла

### 12. copter-soft.js

**Назначение**: Управление данными склада и результатами инвентаризации.

**Класс: CopterSoft extends EventEmitter**

**Свойства:**
- `resultsLocation` - директория для сохранения результатов
- `warehouse` - объект склада (JSON)
- `loadedAlleyFilename` - имя файла загруженной аллеи

**Методы:**
- `reloadWarehouse()` - перезагрузка склада из файла
- `overwriteWarehouse(desc)` - перезапись склада
- `getSavedResults()` - получение списка сохранённых результатов
- `getSavedResult(name)` - получение сохранённого результата (base64)
- `deleteSavedResult(name)` - удаление результата
- `deleteAllSavedResults()` - удаление всех результатов
- `getSavedResultFilename(name)` - получение пути к файлу результата
- `overwriteLoadedAlleyFilename(file)` - сохранение имени загруженной аллеи

**Переменные окружения:**
- `WAREHOUSE_FILE` - путь к файлу склада
- `WAREHOUSE_LOADED_ALLEY_FILE` - путь к файлу загруженной аллеи
- `WAREHOUSE_RESULTS_DIR` - директория результатов

### 13. lic.js

**Назначение**: Проверка лицензии.

**Экспорты:**
- `ok` - лицензия валидна
- `vt` - время окончания лицензии (timestamp)
- `vf` - время начала лицензии (timestamp)
- `exp` - лицензия истекла
- `ntr` - лицензия ещё не активна
- `sw` - программное обеспечение разрешено к использованию

**Механизм:**
- Читает серийный номер из `/sys/firmware/devicetree/base/serial-number`
- Читает лицензионный ключ из файла `LICENSE_KEY`
- Проверяет HMAC-SHA256 подпись

### 14. http-server.js

**Назначение**: HTTP сервер для скачивания результатов инвентаризации.

**Функции:**
- `startResultDownloadServer(port, host, callback)` - запуск сервера
  - Создаёт TAR архив с результатами
  - Поддерживает скачивание по пути `/{warehouse}/{alley}.tar`
  - Использует безопасные пути (защита от path traversal)

### 15. box-counting.js

**Назначение**: Модуль для работы с подсчётом коробок (альтернативный режим работы).

**Экспорты:**
- `protocolPackMsg(args)` - упаковка сообщения протокола
- `hub` - EventEmitter для событий
- `sendReq(req)` - отправка запроса

**События:**
- `req` - получен запрос от клиента
- `totalBoxes` - получено количество коробок
- `palletBottomVisible` - видимость дна паллеты

**Сервисы:**
- TCP сервер на порту 8081 (клиенты)
- TCP клиент к сервису на порту 8082
- UDP сервер на порту 8088 (видимость дна паллеты)

### 16. index-box-counting.js

**Назначение**: Альтернативная точка входа для режима подсчёта коробок.

**Отличия от index.js:**
- Использует `box-counting.js` вместо `protocol.js`
- Работает с задачами сканирования (alley, bin, zone)
- Сохраняет результаты в `boxCountingReport.json`
- Управляет направлением полёта (forward/backward)

## Потоки данных

### 1. Сканер → Python модуль

```
Сканер (Serial) 
  → scannerRl.on('data') 
  → protocol.send('barcode', buff)
  → TCP Server (mintt)
  → Python модуль
```

### 2. RC Channels → Действия

```
MAVLink RC_CHANNELS
  → mavSystem.on('rc_channels')
  → checkButton()
  → handleButton() / nextAlley() / prevAlley()
  → protocol.send('button', label)
  → Python модуль
```

### 3. Python модуль → OSD

```
Python модуль
  → TCP Client (mintt)
  → protocol.on('osd_*')
  → ui.update()
  → osd.renderElements()
  → osdSp.write()
  → Serial Port
  → Полётный контроллер (OSD)
```

### 4. MAVLink Heartbeat → Статус

```
Полётный контроллер
  → Serial Port (MAVLink)
  → mavSystem.on('heartbeat')
  → mavlinkHeartbeat = true
  → connectionStatus()
  → ui.update('connection', status)
```

### 5. Фотография

```
RC Channel 7 (PHOTO)
  → checkButton()
  → takePhoto(id, callback)
  → camera.once('data')
  → exifRotate()
  → protocol.send('photo', {id}, data)
  → Python модуль
```

### 6. Загрузка аллеи

```
Dashboard / RC Channel 9
  → protocol.send('load_alley', {alley, pilot})
  → Python модуль
  → protocol.on('table_json')
  → copterSoft.overwriteLoadedAlleyFilename()
  → ui.update({palletAlley, palletLevel, palletName})
```

## Переменные окружения

### MAVLink
- `MAVLINK_SERIAL_PATH` - путь к последовательному порту MAVLink (по умолчанию: `/dev/ttyACM0`)
- `MAVLINK_SERIAL_BAUD` - скорость порта MAVLink (по умолчанию: `57600`)
- `MAVLINK_UDP_EN` - включить UDP для MAVLink (по умолчанию: `false`)
- `MAVLINK_UDP_HOST` - хост UDP для MAVLink (по умолчанию: `0.0.0.0`)
- `MAVLINK_UDP_PORT` - порт UDP для MAVLink (по умолчанию: `14550`)
- `MAVLINK_SYSTEM_ID` - ID системы MAVLink (по умолчанию: `1`)

### Сканер и OSD
- `SCANNER_SERIAL_PATH` - путь к последовательному порту сканера (по умолчанию: `/dev/ttyAMA0`)
- `SCANNER_SERIAL_BAUD` - скорость порта сканера (по умолчанию: `115200`)
- `SCANNER_SERIAL_RECONNECT_TIMEOUT` - таймаут переподключения сканера (по умолчанию: `0`)
- `OSD_SERIAL_PATH` - путь к последовательному порту OSD (по умолчанию: `SCANNER_SERIAL_PATH`)
- `OSD_SERIAL_BAUD` - скорость порта OSD (по умолчанию: `SCANNER_SERIAL_BAUD`)
- `OSD_WIDTH` - ширина экрана OSD (по умолчанию: `30`)
- `OSD_HEIGHT` - высота экрана OSD (по умолчанию: `16`)
- `OSD_PADDING_TOP`, `OSD_PADDING_BOTTOM`, `OSD_PADDING_LEFT`, `OSD_PADDING_RIGHT` - отступы OSD

### RC Channels
- `RC_EMPTY_CH`, `RC_RESCAN_CH`, `RC_NO_TAG_CH`, `RC_UNREADABLE_CH`, `RC_PHOTO_CH`, `RC_SCANOFF_CH`, `RC_ALLEY_SWITCH_CH` - номера каналов
- `RC_EMPTY_PWM`, `RC_RESCAN_PWM`, `RC_NO_TAG_PWM`, `RC_UNREADABLE_PWM`, `RC_PHOTO_PWM`, `RC_SCANOFF_PWM`, `RC_ALLEY_NEXT_PWM`, `RC_ALLEY_PREV_PWM` - значения PWM

### Протокол (mintt)
- `MINTT_PORT` - порт TCP сервера протокола (по умолчанию: `55757`)
- `MINTT_HOST` - хост TCP сервера протокола (по умолчанию: `0.0.0.0`)

### Камера
- `CAMERA_EN` - включить камеру (по умолчанию: `false`)
- `PHOTO_WIDTH` - ширина фотографии (по умолчанию: `2028`)
- `PHOTO_HEIGHT` - высота фотографии (по умолчанию: `1520`)
- `PHOTO_EXIF_ORIENTATION` - ориентация EXIF (по умолчанию: `6`)

### RealSense
- `REALSENSEPY_EN` - включить RealSense (по умолчанию: `false`)
- `REALSENSEPY_CAMERA_ORIENTATION` - ориентация камеры RealSense
- `REALSENSEPY_UDP_HOST` - хост UDP для RealSense (по умолчанию: `localhost`)
- `REALSENSEPY_UDP_PORT` - порт UDP для RealSense (по умолчанию: `14552`)

### CopterSoft
- `WAREHOUSE_FILE` - путь к файлу склада
- `WAREHOUSE_LOADED_ALLEY_FILE` - путь к файлу загруженной аллеи
- `WAREHOUSE_RESULTS_DIR` - директория результатов
- `WAREHOUSE_RESULTS_TAR_SERVER_PORT` - порт HTTP сервера для скачивания результатов (по умолчанию: `8082`)

### Общие
- `DRONE_ID` - ID дрона (по умолчанию: `00`)
- `COPTER_SOFT_EN` - включить модуль CopterSoft (по умолчанию: `false`)

## Схема взаимодействия компонентов

```
┌─────────────┐
│  index.js   │
└──────┬──────┘
       │
       ├───► mavlink/system.js ───► Serial Port (MAVLink)
       │
       ├───► protocol.js ───► TCP Server (Python модуль)
       │
       ├───► dashboard.js ───► HTTP/WebSocket (Браузер)
       │
       ├───► ui.js ───► osd.js ───► Serial Port (OSD)
       │
       ├───► photo.js ───► camera.js ───► libcamera-vid
       │
       ├───► rc.js (обработка RC channels)
       │
       ├───► copter-soft.js (управление складом)
       │
       └───► lic.js (проверка лицензии)
```

## Последовательность инициализации

1. Загрузка переменных окружения (`dotenv`)
2. Проверка лицензии (`lic.js`)
3. Инициализация последовательных портов:
   - MAVLink (`mavlinkSerial`)
   - Сканер (`scannerSp`)
   - OSD (`osdSp`)
4. Создание MAVLink системы (`MavSystem`)
5. Настройка подписок на MAVLink сообщения
6. Инициализация протокола (`protocol.js`)
7. Инициализация дашборда (`dashboard.js`)
8. Настройка UI и OSD (`ui.js`, `osd.js`)
9. Подключение обработчиков событий:
   - Сканер → Протокол
   - RC Channels → Кнопки
   - Протокол → UI/OSD
   - MAVLink Heartbeat → Статус
10. Запуск периодических задач:
    - Обновление IP адреса
    - Обновление статуса подключения
    - Отправка heartbeat

## Зависимости

### Основные
- `serialport` - работа с последовательными портами
- `@serialport/parser-delimiter` - парсер с разделителями
- `ws` - WebSocket сервер
- `finalhandler`, `serve-static` - HTTP сервер
- `lodash` - утилиты
- `piexifjs` - работа с EXIF
- `cancelable-promise` - отменяемые промисы
- `debounce` - debounce функции
- `dotenv` - переменные окружения

### Внешние команды
- `libcamera-vid` - видеопоток с камеры Raspberry Pi

## Безопасность

1. **Лицензирование**: Проверка лицензии через HMAC-SHA256
2. **Path Traversal**: Защита в `http-server.js` через `safePath()`
3. **WebSocket**: Таймаут неактивных соединений (60 секунд)

## Расширяемость

Проект легко расширяется через:
1. Добавление новых RC каналов в `index.js`
2. Добавление новых UI элементов в `ui.js`
3. Добавление новых топиков протокола в `protocol.js`
4. Добавление новых MAVLink команд в `mavlink/system.js`

