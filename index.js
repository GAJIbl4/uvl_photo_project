#!/usr/bin/env node

import { SerialPort } from 'serialport';

const PORT = '/dev/ttyS0';
const BAUD_RATE = 115200;

const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  message: (msg) => console.log(`[MSG] ${new Date().toISOString()} - ${msg}`),
};

// Буфер для накопления данных
let buffer = Buffer.alloc(0);

// MAVLink 1.0 структура пакета:
// [0xFE] [length] [sequence] [system_id] [component_id] [message_id] [payload...] [crc_low] [crc_high]

function crc16(data, crc = 0xFFFF) {
  for (let i = 0; i < data.length; i++) {
    let tmp = data[i] ^ (crc & 0xFF);
    tmp = (tmp ^ (tmp << 4)) & 0xFF;
    crc = (crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4);
    crc = crc & 0xFFFF;
  }
  return crc;
}

function parseMavlink1(buffer) {
  const packets = [];
  let offset = 0;

  while (offset < buffer.length) {
    // Ищем magic byte 0xFE
    const magicIndex = buffer.indexOf(0xFE, offset);
    if (magicIndex === -1) break;

    // Проверяем, достаточно ли данных для заголовка (минимум 6 байт: FE + length + seq + sys + comp + msg)
    if (magicIndex + 6 > buffer.length) break;

    const length = buffer[magicIndex + 1];
    const packetLength = 6 + length + 2; // заголовок (6) + payload + CRC (2)

    // Проверяем, есть ли полный пакет
    if (magicIndex + packetLength > buffer.length) break;

    // Извлекаем пакет
    const packet = buffer.slice(magicIndex, magicIndex + packetLength);
    
    // Проверяем CRC
    const header = packet.slice(0, 6);
    const payload = packet.slice(6, 6 + length);
    const receivedCrc = packet.readUInt16LE(6 + length);
    
    // Вычисляем CRC для MAVLink 1.0
    // CRC включает: заголовок (без magic byte) + payload + message_id (добавляется отдельно)
    const headerWithoutMagic = header.slice(1); // без 0xFE
    let calcCrc = crc16(headerWithoutMagic);
    calcCrc = crc16(payload, calcCrc);
    
    // MAVLink 1.0 добавляет message_id в CRC отдельно
    const messageId = header[5];
    calcCrc = crc16(Buffer.from([messageId]), calcCrc);

    if (calcCrc === receivedCrc) {
      // Пакет валидный
      const messageId = header[5];
      const systemId = header[3];
      const componentId = header[4];
      
      packets.push({
        messageId,
        systemId,
        componentId,
        payload,
        raw: packet
      });

      offset = magicIndex + packetLength;
    } else {
      // CRC не совпадает, ищем следующий magic byte
      offset = magicIndex + 1;
    }
  }

  return { packets, remaining: buffer.slice(offset) };
}

// Названия сообщений MAVLink 1.0 (основные)
const MESSAGE_NAMES = {
  0: 'HEARTBEAT',
  1: 'SYS_STATUS',
  2: 'SYSTEM_TIME',
  24: 'GPS_RAW_INT',
  65: 'RC_CHANNELS',
  74: 'VFR_HUD',
  105: 'HIGH_LATENCY',
  109: 'VIBRATION',
  147: 'BATTERY_STATUS',
  253: 'STATUSTEXT',
};

function formatMessage(messageId, payload) {
  const name = MESSAGE_NAMES[messageId] || `MSG_${messageId}`;
  
  if (messageId === 0) { // HEARTBEAT
    const type = payload[0];
    const autopilot = payload[1];
    const baseMode = payload[2];
    const customMode = payload.readUInt32LE(3);
    const systemStatus = payload[7];
    return `${name}: type=${type} autopilot=${autopilot} mode=${baseMode} status=${systemStatus}`;
  }
  
  if (messageId === 65) { // RC_CHANNELS
    const chan1 = payload.readUInt16LE(4);
    const chan2 = payload.readUInt16LE(6);
    const chan3 = payload.readUInt16LE(8);
    const chan4 = payload.readUInt16LE(10);
    const chan5 = payload.readUInt16LE(12);
    const chan6 = payload.readUInt16LE(14);
    const chan7 = payload.readUInt16LE(16);
    const chan8 = payload.readUInt16LE(18);
    return `${name}: RC1=${chan1} RC2=${chan2} RC3=${chan3} RC4=${chan4} RC5=${chan5} RC6=${chan6} RC7=${chan7} RC8=${chan8}`;
  }
  
  if (messageId === 253) { // STATUSTEXT
    const severity = payload[0];
    const text = payload.slice(1).toString('utf8').replace(/\0/g, '');
    return `${name}: [${severity}] ${text}`;
  }
  
  return `${name}: ${payload.length} bytes`;
}

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
log.info('Запуск MAVLink парсера');
log.info('='.repeat(60));
log.info(`Порт: ${PORT}`);
log.info(`Скорость: ${BAUD_RATE}`);
log.info('Ожидание MAVLink пакетов...');
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
  // Добавляем данные в буфер
  buffer = Buffer.concat([buffer, data]);
  
  // Парсим пакеты
  const result = parseMavlink1(buffer);
  buffer = result.remaining;
  
  // Выводим найденные пакеты
  for (const packet of result.packets) {
    const formatted = formatMessage(packet.messageId, packet.payload);
    log.message(`[SYS:${packet.systemId} COMP:${packet.componentId}] ${formatted}`);
  }
  
  // Если буфер слишком большой (больше 1KB), очищаем его
  if (buffer.length > 1024) {
    log.info(`Буфер слишком большой (${buffer.length} байт), очищаю...`);
    buffer = Buffer.alloc(0);
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
