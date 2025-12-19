#!/usr/bin/env node

import { SerialPort } from 'serialport';

const PORT = '/dev/ttyS0';
const BAUD_RATE = 115200;

const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  hex: (data) => console.log(`[HEX] ${data.toString('hex')}`),
  raw: (data) => console.log(`[RAW]`, data),
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
log.info('Запуск простого Serial монитора');
log.info('='.repeat(60));
log.info(`Порт: ${PORT}`);
log.info(`Скорость: ${BAUD_RATE}`);
log.info('Ожидание данных...');
log.info('='.repeat(60));

const port = new SerialPort({
  path: PORT,
  baudRate: BAUD_RATE,
  lock: false
});

port.on('open', () => {
  log.info('Порт открыт успешно!');
});

port.on('data', (data) => {
  // Выводим сырые данные в hex формате
  log.hex(data);
  
  // Также выводим как буфер для анализа
  if (data.length > 0) {
    const hexString = Array.from(data)
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' ');
    log.info(`Получено ${data.length} байт: ${hexString}`);
    
    // Проверяем на наличие MAVLink magic bytes
    const magicIndex = data.indexOf(0xFD); // MAVLink 2.0
    const magicIndexV1 = data.indexOf(0xFE); // MAVLink 1.0
    
    if (magicIndex !== -1) {
      log.info(`✓ Найден MAVLink 2.0 magic byte (0xFD) на позиции ${magicIndex}`);
    }
    if (magicIndexV1 !== -1) {
      log.info(`✓ Найден MAVLink 1.0 magic byte (0xFE) на позиции ${magicIndexV1}`);
    }
  }
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
