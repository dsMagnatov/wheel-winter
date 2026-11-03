import { readFile, writeFile } from 'node:fs/promises';
import { sanitizeSettings } from '../src/settings.js';

try {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('Вкажіть шлях до JSON-файлу, експортованого з панелі.');

  const { version, settings } = JSON.parse(await readFile(inputPath, 'utf8'));
  if (!Number.isInteger(version) || version < 1 || !settings || Array.isArray(settings) || typeof settings !== 'object') {
    throw new Error('Очікується експорт налаштувань Winter Wheel Studio.');
  }

  const preset = sanitizeSettings(settings);
  if (version < 6) delete preset.rpm;
  if (!Object.keys(preset).length) throw new Error('У файлі немає коректних параметрів сцени.');

  const destination = new URL('../src/scene-preset.json', import.meta.url);
  await writeFile(destination, JSON.stringify(preset, null, 2) + '\n');
  console.log(`Базовий пресет оновлено (${Object.keys(preset).length} параметрів).`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
