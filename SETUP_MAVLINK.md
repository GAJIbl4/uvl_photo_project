# Установка MAVLink JavaScript_NextGen библиотеки

## Шаг 1: Установка Python и pymavlink

```bash
# Установка Python 3 (если ещё не установлен)
sudo apt update
sudo apt install python3 python3-pip

# Установка pymavlink
pip3 install pymavlink
```

## Шаг 2: Клонирование репозитория MAVLink

```bash
cd ~
git clone https://github.com/mavlink/mavlink.git
cd mavlink
```

## Шаг 3: Генерация JavaScript_NextGen библиотеки

```bash
# Генерация библиотеки для MAVLink 2.0
python3 -m pymavlink.tools.mavgen \
  --lang=JavaScript_NextGen \
  --wire-protocol=2.0 \
  --output=./generated/mavlink \
  message_definitions/v1.0/common.xml
```

Или для полного набора сообщений (включая ArduPilot):

```bash
python3 -m pymavlink.tools.mavgen \
  --lang=JavaScript_NextGen \
  --wire-protocol=2.0 \
  --output=./generated/mavlink \
  message_definitions/v1.0/ardupilotmega.xml
```

## Шаг 4: Копирование библиотеки в проект

```bash
# Из директории mavlink
cp -r generated/mavlink/* ~/uvl_photo_project/mavlink/
```

## Шаг 5: Использование в проекте

После генерации библиотеки, обновите `index.js` для использования сгенерированных модулей.

