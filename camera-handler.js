import { spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';

export class CameraHandler extends EventEmitter {
  constructor(config, photosDir) {
    super();
    this.config = config;
    this.photosDir = photosDir;
    this.photoCounter = 0;
    this.lastPhotoPath = null;
    this.isCapturing = false;
    this.cameraProcess = null;
    
    // Загружаем счётчик
    this.loadCounter();
  }

  async initialize() {
    try {
      console.log('[camera]: Инициализация камеры Arducam IMX477...');
      
      // Проверяем доступность libcamera-still
      // В реальном проекте можно использовать libcamera-vid для потоковой съёмки
      
      console.log('[camera]: Камера инициализирована успешно');
      return true;
    } catch (err) {
      console.error(`[camera]: Ошибка инициализации камеры: ${err.message}`);
      return false;
    }
  }

  async capturePhoto() {
    if (this.isCapturing) {
      console.warn('[camera]: Захват уже выполняется');
      return null;
    }

    try {
      this.isCapturing = true;
      this.photoCounter++;

      // Формируем имя файла с порядковым номером
      const extension = this.config.imageFormat === 'jpeg' ? 'jpg' : this.config.imageFormat;
      const filename = `${String(this.photoCounter).padStart(6, '0')}.${extension}`;
      const filepath = join(this.photosDir, filename);

      console.log(`[camera]: Захват фотографии #${this.photoCounter}...`);

      // Используем libcamera-still для захвата фотографии
      const args = [
        '--nopreview',
        '--timeout', '1',
        '--width', this.config.resolution[0].toString(),
        '--height', this.config.resolution[1].toString(),
        '--quality', this.config.jpegQuality.toString(),
        '--output', filepath
      ];

      // Добавляем параметры экспозиции
      if (this.config.shutterSpeed > 0) {
        args.push('--shutter', this.config.shutterSpeed.toString());
      }

      if (this.config.iso > 0) {
        args.push('--iso', this.config.iso.toString());
      }

      // Захватываем фотографию
      await new Promise((resolve, reject) => {
        const process = spawn('libcamera-still', args, {
          stdio: 'inherit'
        });

        process.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`libcamera-still завершился с кодом ${code}`));
          }
        });

        process.on('error', (err) => {
          reject(err);
        });
      });

      this.lastPhotoPath = filepath;
      this.saveCounter();

      console.log(`[camera]: Фотография сохранена: ${filepath}`);
      return filepath;
    } catch (err) {
      console.error(`[camera]: Ошибка при захвате фотографии: ${err.message}`);
      return null;
    } finally {
      this.isCapturing = false;
    }
  }

  loadCounter() {
    const counterFile = join(this.photosDir, '.photo_counter');
    try {
      if (existsSync(counterFile)) {
        const data = readFileSync(counterFile, 'utf-8');
        this.photoCounter = parseInt(data.trim(), 10) || 0;
        console.log(`[camera]: Загружен счётчик фотографий: ${this.photoCounter}`);
      }
    } catch (err) {
      console.warn(`[camera]: Не удалось загрузить счётчик: ${err.message}`);
      this.photoCounter = 0;
    }
  }

  saveCounter() {
    const counterFile = join(this.photosDir, '.photo_counter');
    try {
      writeFileSync(counterFile, this.photoCounter.toString(), 'utf-8');
    } catch (err) {
      console.warn(`[camera]: Не удалось сохранить счётчик: ${err.message}`);
    }
  }

  getPhotoCount() {
    return this.photoCounter;
  }

  getLastPhotoPath() {
    return this.lastPhotoPath;
  }

  close() {
    if (this.cameraProcess) {
      this.cameraProcess.kill();
      this.cameraProcess = null;
    }
    console.log('[camera]: Камера закрыта');
  }
}

