#!/usr/bin/env node

import { SerialPort } from 'serialport';
import { MavlinkClient } from './mavlink-client.js';
import { CameraHandler } from './camera-handler.js';
import * as ui from './ui.js';
import * as osd from './osd.js';
import { checkButton } from './rc.js';
import {
  PHOTOS_DIR,
  MAVLINK_CONFIG,
  RC_CHANNEL,
  RC_THRESHOLD,
  CAMERA_CONFIG,
  OSD_CONFIG,
} from './config.js';
import winston from 'winston';

// Настройка логирования
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level.toUpperCase()}] ${message}${stack ? '\n' + stack : ''}`;
  })
);

const logger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    new winston.transports.File({ filename: '/home/pi/photo_project.log' }),
    new winston.transports.Console()
  ]
});

// Глобальные переменные
let running = true;
let mavlinkClient = null;
let cameraHandler = null;
let rcTriggered = false;

// Обработчик сигналов
process.on('SIGINT', () => {
  logger.info('Получен сигнал завершения, останавливаюсь...');
  running = false;
});

process.on('SIGTERM', () => {
  logger.info('Получен сигнал завершения, останавливаюсь...');
  running = false;
});

async function main() {
  logger.info('='.repeat(60));
  logger.info('Запуск системы фотографирования с Ardupilot');
  logger.info('='.repeat(60));
  logger.info(`Папка для фотографий: ${PHOTOS_DIR}`);
  logger.info(`MAVLink UDP: ${MAVLINK_CONFIG.udpHost}:${MAVLINK_CONFIG.udpPort}`);
  logger.info(`RC канал для триггера: ${RC_CHANNEL}`);
  logger.info(`Порог активации: ${RC_THRESHOLD}`);

  try {
    // Инициализация MAVLink клиента через UDP
    logger.info('Инициализация MAVLink через UDP...');
    mavlinkClient = new MavlinkClient(
      MAVLINK_CONFIG.udpHost,
      MAVLINK_CONFIG.udpPort,
      MAVLINK_CONFIG.systemId,
      MAVLINK_CONFIG.componentId
    );

    mavlinkClient.on('error', (err) => {
      logger.error(`[mavlink]: Ошибка UDP: ${err.message}`);
    });

    mavlinkClient.on('connected', () => {
      logger.info('[mavlink]: Подключение установлено!');
    });

    await mavlinkClient.connect();
    logger.info('[mavlink]: Подключение установлено!');

    // Инициализация камеры
    logger.info('Инициализация камеры...');
    cameraHandler = new CameraHandler(CAMERA_CONFIG, PHOTOS_DIR);
    const cameraInitialized = await cameraHandler.initialize();
    if (!cameraInitialized) {
      logger.error('Не удалось инициализировать камеру');
      mavlinkClient.close();
      return 1;
    }

    // Инициализация OSD (если включен)
    let osdSerial = null;
    if (OSD_CONFIG.enabled) {
      logger.info(`Инициализация OSD на порту ${OSD_CONFIG.port}...`);
      try {
        osdSerial = new SerialPort({
          path: OSD_CONFIG.port,
          baudRate: OSD_CONFIG.baudrate,
          lock: false
        });

        osdSerial.on('error', (err) => {
          logger.error(`[osd]: Ошибка последовательного порта: ${err.message}`);
        });

        // Настройка UI для OSD
        ui.configure(osdSerial.write.bind(osdSerial), {
          width: OSD_CONFIG.width,
          height: OSD_CONFIG.height,
          paddingTop: OSD_CONFIG.paddingTop,
          paddingBottom: OSD_CONFIG.paddingBottom,
          paddingRight: OSD_CONFIG.paddingRight,
          paddingLeft: OSD_CONFIG.paddingLeft,
        });

        // Настройка layout OSD
        ui.updateLayout({
          mavlinkStatus: ['top', 'left', 'MAV: '],
          cameraStatus: ['top', 'left +10', 'CAM: '],
          photoCount: ['top +1', 'left', 'Photos: '],
          lastPhoto: ['top +2', 'left', 'Last: '],
          error: ['bottom', 'left', 'ERR: '],
        });

        logger.info('[osd]: OSD подключен успешно');
        setTimeout(() => ui.render(), 2000);
      } catch (err) {
        logger.error(`Ошибка при инициализации OSD: ${err.message}`, { stack: err.stack });
        osdSerial = null;
      }
    }

    // Обработка RC_CHANNELS
    mavlinkClient.on('rc_channels', msg => {
      // Используем checkButton из исходного проекта
      const buttonState = checkButton(msg, RC_CHANNEL, RC_THRESHOLD, 'PHOTO', 
        () => {
          // Callback при нажатии кнопки
          if (!rcTriggered) {
            rcTriggered = true;
            const rcValue = msg[`chan${RC_CHANNEL}_raw`];
            logger.info(`RC${RC_CHANNEL} активирован (значение: ${rcValue})`);

            // Делаем фотографию
            if (cameraHandler) {
              cameraHandler.capturePhoto()
                .then((photoPath) => {
                  if (photoPath) {
                    const photoCount = cameraHandler.getPhotoCount();
                    const filename = photoPath.split('/').pop();
                    
                    // Обновляем OSD
                    ui.update('photoCount', photoCount);
                    ui.update('lastPhoto', filename);
                    
                    // Отправляем сообщение через MAVLink
                    mavlinkClient.sendStatusText(`Photo #${photoCount} saved: ${filename}`);
                    logger.info(`Фотография #${photoCount} сохранена: ${filename}`);
                  } else {
                    ui.update('error', 'Ошибка захвата фото');
                    mavlinkClient.sendStatusText('ERROR: Ошибка захвата фото', 3); // MAV_SEVERITY_ERROR
                    logger.error('Ошибка захвата фото');
                  }
                })
                .catch((err) => {
                  logger.error(`Ошибка при захвате фотографии: ${err.message}`);
                  ui.update('error', 'Ошибка захвата фото');
                  mavlinkClient.sendStatusText('ERROR: Ошибка захвата фото', 3);
                });
            }
          }
        },
        () => {
          // Callback при отпускании кнопки
          if (rcTriggered) {
            rcTriggered = false;
            logger.debug(`RC${RC_CHANNEL} деактивирован`);
          }
        }
      );
    });

    // Обновление статуса на OSD
    ui.update('mavlinkStatus', 'MAV: ✓');
    ui.update('cameraStatus', 'CAM: ✓');
    ui.update('photoCount', cameraHandler.getPhotoCount());
    
    // Периодическое обновление статуса на OSD
    setInterval(() => {
      ui.update('mavlinkStatus', 'MAV: ✓');
      ui.update('cameraStatus', 'CAM: ✓');
      ui.update('photoCount', cameraHandler.getPhotoCount());
    }, 1000);

    mavlinkClient.sendStatusText('Система готова к работе');
    logger.info('Система инициализирована, ожидание команд...');

    // Основной цикл
    let lastStatusLogTime = 0;
    const statusLogInterval = 5000;

    while (running) {
      try {
        // Периодическое обновление статуса
        const currentTime = Date.now();
        if (currentTime - lastStatusLogTime >= statusLogInterval) {
          lastStatusLogTime = currentTime;
          // Обновляем статус на OSD
          ui.update('mavlinkStatus', 'MAV: ✓');
          ui.update('cameraStatus', 'CAM: ✓');
          ui.update('photoCount', cameraHandler.getPhotoCount());
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        logger.error(`Ошибка в основном цикле: ${err.message}`, { stack: err.stack });
        ui.update('error', `Ошибка: ${err.message.slice(0, 20)}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  } catch (err) {
    logger.error(`Критическая ошибка: ${err.message}`, { stack: err.stack });
    return 1;
  } finally {
    logger.info('Завершение работы...');

    if (cameraHandler) {
      cameraHandler.close();
    }

    if (mavlinkClient) {
      mavlinkClient.sendStatusText('Система завершает работу');
      mavlinkClient.close();
    }

    logger.info('Работа завершена');
  }

  return 0;
}

// Запуск
main()
  .then((code) => {
    process.exit(code || 0);
  })
  .catch((err) => {
    logger.error(`Критическая ошибка: ${err.message}`, { stack: err.stack });
    process.exit(1);
  });
