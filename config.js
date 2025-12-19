// Настройки подключения к полётному контроллеру через Serial
export const MAVLINK_CONFIG = {
  port: '/dev/ttyS0',  // Serial порт для подключения к полётному контроллеру
  baudRate: 115200,  // Скорость передачи
  systemId: 1,  // System ID для этого приложения
  componentId: 191,  // Component ID для companion computer (MAV_COMP_ID_ONBOARD_COMPUTER)
};

// Канал RC для мониторинга (RC6)
export const RC_CHANNEL = 6;

