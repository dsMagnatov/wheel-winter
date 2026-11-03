import './site-base.css';
import './promo.css';
import { defaults } from './settings.js';
import { WinterScene } from './scene.js';
import { catalogProducts, mountCatalog } from './catalog-ui.js';
import { loadProjectTextures } from './project-textures.js';
import { startPreloader } from './preloader.js';

const $ = (selector) => document.querySelector(selector);
const preloader = startPreloader();
let scene;

try {
  const catalog = mountCatalog({
    onMove: direction => scene.catalog.move(direction),
    onPause: paused => scene.catalog.setPaused(paused),
    onBack: () => scene.returnFromCatalog(),
    onPreview: (canvas, index) => scene.drawCatalogPreview(canvas, index),
  });
  const gauge = $('#promo-rpm');
  scene = new WinterScene($('#scene'), { ...defaults }, (_, rpm) => {
    gauge.textContent = String(Math.round(Math.abs(rpm))).padStart(3, '0');
  }, catalogProducts, catalog);
  scene.setPanelVisible(false);
  await scene.ready;
  preloader.sceneReady();
  await loadProjectTextures(scene).catch(error => console.warn('Project textures:', error));
  preloader.finish();
} catch (error) {
  console.error('Scene initialization failed', error);
  $('#error').hidden = false;
  $('#loading').hidden = true;
}
