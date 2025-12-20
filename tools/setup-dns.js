#!/usr/bin/env node

/**
 * Node.js обертка для скрипта настройки DNS
 * Проверяет права и запускает bash скрипт setup-dns.sh
 */

const { execSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, 'setup-dns.sh');

// Проверяем, что мы на Linux/Unix системе
if (process.platform === 'win32') {
  console.log('[setup-dns]: Пропуск настройки DNS (Windows не поддерживается)');
  process.exit(0);
}

// Проверяем существование скрипта
if (!existsSync(SCRIPT_PATH)) {
  console.log('[setup-dns]: Скрипт setup-dns.sh не найден, пропуск настройки DNS');
  process.exit(0);
}

// Проверяем права root
const isRoot = process.getuid && process.getuid() === 0;

if (!isRoot) {
  // Пропускаем автоматическую настройку, если нет прав root
  // Это нормально при обычном npm install без sudo
  if (process.env.SKIP_DNS_SETUP !== 'true') {
    console.log('[setup-dns]: Пропуск автоматической настройки DNS (требуются права root)');
    console.log('[setup-dns]: Для настройки DNS запустите: sudo npm run setup-dns');
    console.log('[setup-dns]: Или вручную: sudo ./tools/setup-dns.sh');
  }
  process.exit(0);
}

// Запускаем bash скрипт
try {
  console.log('[setup-dns]: Запуск настройки DNS...');
  execSync(`bash "${SCRIPT_PATH}"`, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
  console.log('[setup-dns]: Настройка DNS завершена успешно');
} catch (error) {
  console.error('[setup-dns]: Ошибка при настройке DNS:', error.message);
  // Не падаем, чтобы не сломать npm install
  process.exit(0);
}

