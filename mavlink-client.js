import dgram from 'dgram';
import { EventEmitter } from 'events';

// Простой парсер MAVLink 2.0 для работы через UDP
// Используется для чтения RC_CHANNELS и отправки STATUSTEXT

const MAVLINK_MSG_ID_RC_CHANNELS = 65;
const MAVLINK_MSG_ID_STATUSTEXT = 253;
const MAVLINK_MSG_ID_HEARTBEAT = 0;
const MAVLINK_MSG_ID_AUTOPILOT_VERSION = 148;

const MAV_TYPE_ONBOARD_CONTROLLER = 18;
const MAV_AUTOPILOT_INVALID = 8;
const MAV_COMP_ID_ONBOARD_COMPUTER = 191;
const MAV_SEVERITY_INFO = 6;
const MAV_SEVERITY_ERROR = 3;

export class MavlinkClient extends EventEmitter {
  constructor(host, port, systemId, componentId) {
    super();
    this.host = host;
    this.port = port;
    this.systemId = systemId;
    this.componentId = componentId;
    this.socket = null;
    this.connected = false;
    this.sequence = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket('udp4');

      this.socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg);
      });

      this.socket.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      this.socket.bind(this.port, () => {
        this.connected = true;
        this.emit('connected');
        // Начинаем отправлять HEARTBEAT
        this.startHeartbeat();
        resolve();
      });
    });
  }

  startHeartbeat() {
    // Отправляем HEARTBEAT каждую секунду
    setInterval(() => {
      this.sendHeartbeat();
    }, 1000);
  }

  sendHeartbeat() {
    const payload = Buffer.alloc(9);
    payload.writeUInt8(MAV_TYPE_ONBOARD_CONTROLLER, 0);
    payload.writeUInt8(MAV_AUTOPILOT_INVALID, 1);
    payload.writeUInt8(0, 2); // base_mode
    payload.writeUInt32LE(0, 3); // custom_mode
    payload.writeUInt8(3, 7); // system_status
    payload.writeUInt8(0, 8); // mavlink_version

    this.sendMessage(MAVLINK_MSG_ID_HEARTBEAT, payload);
  }

  sendStatusText(text, severity = MAV_SEVERITY_INFO) {
    const textBytes = Buffer.from(text, 'utf8');
    const payload = Buffer.alloc(51);
    payload.writeUInt8(severity, 0);
    textBytes.copy(payload, 1, 0, Math.min(50, textBytes.length));
    // Остальные байты уже нули

    this.sendMessage(MAVLINK_MSG_ID_STATUSTEXT, payload);
  }

  sendMessage(messageId, payload) {
    if (!this.connected || !this.socket) return;

    // MAVLink 2.0 заголовок
    const header = Buffer.alloc(10);
    header.writeUInt8(0xFD, 0); // magic
    header.writeUInt8(payload.length, 1); // payload length
    header.writeUInt8(0, 2); // incompatible flags
    header.writeUInt8(0, 3); // compatible flags
    header.writeUInt8(this.sequence, 4); // sequence
    header.writeUInt8(this.systemId, 5); // system ID
    header.writeUInt8(this.componentId, 6); // component ID
    header.writeUInt24LE(messageId, 7); // message ID (3 bytes)

    this.sequence = (this.sequence + 1) % 256;

    // Вычисляем CRC
    let crc = this.crc16(header);
    crc = this.crc16(payload, crc);
    crc = this.crc16(Buffer.from([messageId & 0xFF, (messageId >> 8) & 0xFF, (messageId >> 16) & 0xFF]), crc);

    // Собираем пакет
    const packet = Buffer.concat([header, payload, Buffer.from([crc & 0xFF, (crc >> 8) & 0xFF])]);

    // Отправляем на указанный адрес и порт
    this.socket.send(packet, 0, packet.length, this.port, this.host, (err) => {
      if (err) {
        this.emit('error', err);
      }
    });
  }

  handleMessage(msg) {
    if (msg.length < 12) return; // Минимальный размер MAVLink 2.0 пакета

    // Проверяем magic byte
    if (msg[0] !== 0xFD) return;

    const payloadLength = msg[1];
    const sequence = msg[4];
    const systemId = msg[5];
    const componentId = msg[6];
    const messageId = msg.readUInt24LE(7);

    if (msg.length < 12 + payloadLength) return; // Неполный пакет

    const payload = msg.slice(10, 10 + payloadLength);

    // Парсим RC_CHANNELS
    if (messageId === MAVLINK_MSG_ID_RC_CHANNELS) {
      const rcChannels = {
        time_boot_ms: payload.readUInt32LE(0),
        chan1_raw: payload.readUInt16LE(4),
        chan2_raw: payload.readUInt16LE(6),
        chan3_raw: payload.readUInt16LE(8),
        chan4_raw: payload.readUInt16LE(10),
        chan5_raw: payload.readUInt16LE(12),
        chan6_raw: payload.readUInt16LE(14),
        chan7_raw: payload.readUInt16LE(16),
        chan8_raw: payload.readUInt16LE(18),
        chan9_raw: payload.readUInt16LE(20),
        chan10_raw: payload.readUInt16LE(22),
        chan11_raw: payload.readUInt16LE(24),
        chan12_raw: payload.readUInt16LE(26),
        chan13_raw: payload.readUInt16LE(28),
        chan14_raw: payload.readUInt16LE(30),
        chan15_raw: payload.readUInt16LE(32),
        chan16_raw: payload.readUInt16LE(34),
        chan17_raw: payload.readUInt16LE(36),
        chan18_raw: payload.readUInt16LE(38),
        chancount: payload.readUInt8(40),
        rssi: payload.readUInt8(41),
      };

      this.emit('rc_channels', rcChannels);
    }

    // Парсим HEARTBEAT (для проверки подключения)
    if (messageId === MAVLINK_MSG_ID_HEARTBEAT) {
      this.emit('heartbeat', {
        type: payload[0],
        autopilot: payload[1],
        base_mode: payload[2],
        custom_mode: payload.readUInt32LE(3),
        system_status: payload[7],
        mavlink_version: payload[8],
      });
    }
  }

  crc16(buffer, crc = 0xFFFF) {
    for (let i = 0; i < buffer.length; i++) {
      let tmp = buffer[i] ^ (crc & 0xFF);
      tmp = (tmp ^ (tmp << 4)) & 0xFF;
      crc = (crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4);
      crc = crc & 0xFFFF;
    }
    return crc;
  }

  close() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
  }
}

