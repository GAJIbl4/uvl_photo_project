# Скрипт определения позиции по камере Realsense T265

Работает в паре с ядром инвентаризации [@uvl-robotics/uvl-inventory-offboard-py](/uvl-inventory-offboard-py/README.md)

## Сервисы

- `bt-scanner.service` - сервис подключения Bluetooth сканера
- `hacks.service` - сервис утилит: запускает wifi, открывает порт 80, вызывает sync 10 раз в секунду
- `offboard.service` - сервис ПО инвентаризации
- `offboard-box-counting.service` - сервис [ПО коробочного пересчёта](box-counting.md)
- `realsense.service` - сервис камеры стабилизации realsense

Для запуска модуля необходим образ собранный с драйверами и бинарниками Intel Realsense, включить минимум сервисы `realsense.service` и `offboard.service`.

## Параметры

```ini
REALSENSEPY_CAMERA_ORIENTATION
REALSENSEPY_EN
REALSENSEPY_UDP_HOST
REALSENSEPY_UDP_PORT
```

## Ориентация камеры

```py
# Transformation to convert different camera orientations to NED convention.
# Replace camera_orientation_default for your configuration.

#   0: Forward, USB port to the right
#   1: Downfacing, USB port to the right 
#   2: Forward, 45 degree tilted down, USB port to the right
#   3: Downfacing, USB port to the back
#   4: Upfacing, USB to the front
#   5: Upfacing, USB to the right
#   6: Upfacing, USB to the back

# Important note for downfacing camera: you need to tilt the vehicle's nose up
# a little - not flat - before you run the script, otherwise the initial yaw
# will be randomized, read here for more details:
# https://github.com/IntelRealSense/librealsense/issues/4080.
# Tilt the vehicle to any other sides and the yaw might not be as stable.
camera_orientation_default = 5
```