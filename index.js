#!/usr/bin/env node

import { SerialPort } from 'serialport';
import { createRequire } from 'module';

// MAVLink20Next.js использует CommonJS require
const require = createRequire(import.meta.url);
const mavlink = require('./MAVLink20Next.js');

const PORT = '/dev/ttyS0';
const BAUD_RATE = 115200;

const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  message: (msg) => console.log(`[MSG] ${new Date().toISOString()} - ${msg}`),
};

let running = true;
let mavlinkProcessor = null;

process.on('SIGINT', () => {
  log.info('Получен сигнал завершения, останавливаюсь...');
  running = false;
  if (port && port.isOpen) {
    port.close();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('Получен сигнал завершения, останавливаюсь...');
  running = false;
  if (port && port.isOpen) {
    port.close();
  }
  process.exit(0);
});

log.info('='.repeat(60));
log.info('Запуск MAVLink клиента (JavaScript_NextGen)');
log.info('='.repeat(60));
log.info(`Порт: ${PORT}`);
log.info(`Скорость: ${BAUD_RATE}`);
log.info('='.repeat(60));

// Инициализация MAVLink процессора
// Параметры: logger, srcSystem, srcComponent
mavlinkProcessor = new mavlink.MAVLink20Processor(null, 1, 191);

// Обработка всех сообщений
mavlinkProcessor.on('message', (msg) => {
  log.message(`[${msg._name}] Получено сообщение от SYS:${msg._header?.srcSystem} COMP:${msg._header?.srcComponent}`);
});

// Обработка RC_CHANNELS - вывод RC6
mavlinkProcessor.on('RC_CHANNELS', (msg) => {
  const rc6 = msg.chan6_raw;
  log.message(`RC6: ${rc6}`);
  
  // Также выводим все каналы для отладки
  log.info(`RC_CHANNELS: RC1=${msg.chan1_raw} RC2=${msg.chan2_raw} RC3=${msg.chan3_raw} RC4=${msg.chan4_raw} RC5=${msg.chan5_raw} RC6=${msg.chan6_raw} RC7=${msg.chan7_raw} RC8=${msg.chan8_raw}`);
});

// Обработка HEARTBEAT
mavlinkProcessor.on('HEARTBEAT', (msg) => {
  log.info(`HEARTBEAT: type=${msg.type} autopilot=${msg.autopilot} base_mode=${msg.base_mode} system_status=${msg.system_status}`);
});

// Обработка STATUSTEXT
mavlinkProcessor.on('STATUSTEXT', (msg) => {
  const text = msg.text.toString('utf8').replace(/\0/g, '').trim();
  log.info(`STATUSTEXT [${msg.severity}]: ${text}`);
});

const port = new SerialPort({
  path: PORT,
  baudRate: BAUD_RATE,
  lock: false
});

port.on('open', () => {
  log.info('Порт открыт успешно!');
  log.info('Ожидание MAVLink сообщений...');
});

port.on('data', (data) => {
  // Парсим данные через MAVLink процессор
  try {
    const messages = mavlinkProcessor.parseBuffer(data);
    // Сообщения уже обработаны через события выше
  } catch (err) {
    // Ошибки парсинга обрабатываются внутри процессора
    // Можно добавить дополнительную обработку если нужно
  }
});

port.on('error', (err) => {
  log.error(`Ошибка порта: ${err.message}`);
});

port.on('close', () => {
  log.info('Порт закрыт');
});

// Периодический вывод статистики
setInterval(() => {
  if (mavlinkProcessor) {
    log.info(`Статистика: получено пакетов=${mavlinkProcessor.total_packets_received}, ошибок=${mavlinkProcessor.total_receive_errors}, буфер=${mavlinkProcessor.buf.length} байт`);
  }
}, 10000); // Каждые 10 секунд

// Держим процесс живым
setInterval(() => {
  if (!running) {
    if (port && port.isOpen) {
      port.close();
    }
    process.exit(0);
  }
}, 1000);
