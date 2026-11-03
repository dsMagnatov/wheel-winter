import { defineConfig } from 'vite';
import { scenePresetStorage } from './scripts/scene-preset-storage.js';
import { sceneTextureStorage } from './scripts/scene-texture-storage.js';

export default defineConfig({
  plugins: [scenePresetStorage(), sceneTextureStorage()],
  server: {
    host: '127.0.0.1',
    watch: { ignored: ['**/public/textures/**', '**/public/project-textures/**', '**/.qa/**', '**/.sites-runtime/**', '**/src/scene-preset.json', '**/src/.scene-preset.tmp'] },
  },
});
