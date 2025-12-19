#!/usr/bin/env node

import { MavlinkClient } from './mavlink-client.js';
import { checkButton } from './rc.js';
import {
  MAVLINK_CONFIG,
  RC_CHANNEL,
} from './config.js';

// Простое логирование в консоль
const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`),
};

// Глобальные переменные
let running = true;
let mavlinkClient = null;

// Обработчик сигналов
process.on('SIGINT', () => {
  log.info('Получен сигнал завершения, останавливаюсь...');
  running = false;
});

process.on('SIGTERM', () => {
  log.info('Получен сигнал завершения, останавливаюсь...');
  running = false;
});

async function main() {
  log.info('='.repeat(60));
  log.info('Запуск системы связи с полётным контроллером');
  log.info('='.repeat(60));
  log.info(`Serial порт: ${MAVLINK_CONFIG.port}`);
  log.info(`Скорость: ${MAVLINK_CONFIG.baudRate}`);
  log.info(`RC канал для мониторинга: ${RC_CHANNEL}`);

  try {
    // Инициализация MAVLink клиента через Serial
    log.info('Инициализация MAVLink через Serial...');
    mavlinkClient = new MavlinkClient(
      MAVLINK_CONFIG.port,
      MAVLINK_CONFIG.baudRate,
      MAVLINK_CONFIG.systemId,
      MAVLINK_CONFIG.componentId
    );

    mavlinkClient.on('error', (err) => {
      log.error(`[mavlink]: Ошибка Serial: ${err.message}`);
    });

    mavlinkClient.on('connected', () => {
      log.info('[mavlink]: Подключение установлено!');
    });

    mavlinkClient.on('disconnected', () => {
      log.info('[mavlink]: Подключение разорвано');
    });

    await mavlinkClient.connect();
    log.info('[mavlink]: Подключение установлено!');

    // Обработка RC_CHANNELS - вывод RC6 в консоль
    mavlinkClient.on('rc_channels', msg => {
      const rc6Value = msg[`chan${RC_CHANNEL}_raw`];
      log.info(`RC${RC_CHANNEL}: ${rc6Value}`);

      // Проверка кнопки (для отладки)
      checkButton(msg, RC_CHANNEL, 2000, 'RC6', 
        () => {
          log.info(`RC${RC_CHANNEL} активирован (значение: ${rc6Value})`);
        },
        () => {
          log.debug(`RC${RC_CHANNEL} деактивирован`);
        }
      );
    });

    // Обработка HEARTBEAT
    mavlinkClient.on('heartbeat', (msg) => {
      log.debug(`[mavlink]: HEARTBEAT получен - type: ${msg.type}, status: ${msg.system_status}`);
    });

    mavlinkClient.sendStatusText('Система готова к работе');
    log.info('Система инициализирована, ожидание данных...');

    // Основной цикл
    while (running) {
      try {
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        log.error(`Ошибка в основном цикле: ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  } catch (err) {
    log.error(`Критическая ошибка: ${err.message}`);
    if (err.stack) {
      log.error(`Stack: ${err.stack}`);
    }
    return 1;
  } finally {
    log.info('Завершение работы...');

    if (mavlinkClient) {
      mavlinkClient.sendStatusText('Система завершает работу');
      mavlinkClient.close();
    }

    log.info('Работа завершена');
  }

  return 0;
}

// Запуск
main()
  .then((code) => {
    process.exit(code || 0);
  })
  .catch((err) => {
    log.error(`Критическая ошибка: ${err.message}`);
    if (err.stack) {
      log.error(`Stack: ${err.stack}`);
    }
    process.exit(1);
  });
