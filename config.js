import { mkdirSync } from 'fs';
import { join } from 'path';

// Путь к папке для сохранения фотографий
export const PHOTOS_DIR = '/home/pi/photos';

// Создать папку для фотографий, если её нет
try {
  mkdirSync(PHOTOS_DIR, { recursive: true });
} catch (err) {
  // Папка уже существует или ошибка прав доступа
}

// Настройки подключения к mavlink-router
export const MAVLINK_CONFIG = {
  udpHost: '127.0.0.1',  // Адрес UDP для подключения к mavlink-router
  udpPort: 14550,  // UDP порт для подключения к mavlink-router
  systemId: 1,  // System ID для этого приложения
  componentId: 191,  // Component ID для companion computer (MAV_COMP_ID_ONBOARD_COMPUTER)
};

// Канал RC для триггера фотографии (RC6)
export const RC_CHANNEL = 6;
// Значение PWM для активации кнопки (checkButton проверяет ideal ± 5)
// Обычно для кнопки используется значение около 2000 (максимум) или 1000 (минимум)
export const RC_THRESHOLD = 2000;  // Измените на нужное значение PWM вашей кнопки

// Настройки камеры Arducam Mini HQ IMX477
export const CAMERA_CONFIG = {
  resolution: [4056, 3040],  // Максимальное разрешение для IMX477
  sensorMode: 0,  // Режим сенсора (0 - авто)
  framerate: 10,  // Частота кадров
  shutterSpeed: 0,  // Выдержка в микросекундах (0 - авто)
  iso: 0,  // ISO (0 - авто)
  exposureMode: 'auto',  // Режим экспозиции: auto, off, night, nightpreview, backlight, spotlight, sports, snow, beach, verylong, fixedfps, antishake, fireworks
  awbMode: 'auto',  // Баланс белого: off, auto, sunlight, cloudy, shade, tungsten, fluorescent, incandescent, flash, horizon
  meterMode: 'average',  // Режим замера: average, spot, backlit, matrix
  brightness: 0.0,  // Яркость (-1.0 до 1.0)
  contrast: 1.0,  // Контраст (0.0 до 2.0)
  saturation: 1.0,  // Насыщенность (0.0 до 2.0)
  sharpness: 1.0,  // Резкость (0.0 до 2.0)
  imageFormat: 'jpeg',  // Формат изображения: jpeg, png
  jpegQuality: 95,  // Качество JPEG (1-100)
};

// Настройки обратной связи для OSD
export const OSD_CONFIG = {
  enabled: true,  // Включить отправку данных на OSD
  updateRate: 1.0,  // Частота обновления в секундах
  port: '/dev/ttyACM1',  // Последовательный порт для OSD (отдельный от MAVLink)
  baudrate: 115200,  // Скорость передачи для OSD
  width: 30,  // Ширина экрана OSD
  height: 16,  // Высота экрана OSD
  paddingTop: 1,  // Отступ сверху
  paddingBottom: 5,  // Отступ снизу
  paddingRight: 2,  // Отступ справа
  paddingLeft: 2,  // Отступ слева
};

// Настройки логирования
export const LOG_CONFIG = {
  level: 'info',  // debug, info, warn, error
  file: '/home/pi/photo_project.log',
  console: true,
};

