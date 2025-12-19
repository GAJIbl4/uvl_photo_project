#!/usr/bin/env node

import { SerialPort } from 'serialport';

const PORT = '/dev/ttyS0';
const BAUD_RATE = 115200;

const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  message: (msg) => console.log(`[MSG] ${new Date().toISOString()} - ${msg}`),
};

let running = true;

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
log.info('Ожидание установки библиотеки...');
log.info('='.repeat(60));

// TODO: После установки библиотеки добавить импорт и использование
// import { MAVLink20Processor, ... } from './mavlink';

const port = new SerialPort({
  path: PORT,
  baudRate: BAUD_RATE,
  lock: false
});

port.on('open', () => {
  log.info('Порт открыт успешно!');
  log.info('Ожидание установки MAVLink библиотеки...');
});

port.on('data', (data) => {
  // TODO: После установки библиотеки использовать MAVLink парсер
  // const messages = mavlink.parse(data);
  // for (const msg of messages) {
  //   log.message(`Получено: ${msg.name} - ${JSON.stringify(msg)}`);
  // }
});

port.on('error', (err) => {
  log.error(`Ошибка порта: ${err.message}`);
});

port.on('close', () => {
  log.info('Порт закрыт');
});

// Держим процесс живым
setInterval(() => {
  if (!running) {
    if (port && port.isOpen) {
      port.close();
    }
    process.exit(0);
  }
}, 1000);
