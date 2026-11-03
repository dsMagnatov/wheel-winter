import './site-base.css';
import './promo.css';
import { defaults } from './settings.js';
import { WinterScene } from './scene.js';
import { catalogProducts, mountCatalog } from './catalog-ui.js';
import { loadProjectTextures } from './project-textures.js';

const $ = (selector) => document.querySelector(selector);
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
  await loadProjectTextures(scene).catch(error => console.warn('Project textures:', error));
  const loading = $('#loading');
  loading.classList.add('loaded');
  setTimeout(() => loading.remove(), 800);
} catch (error) {
  console.error('Scene initialization failed', error);
  $('#error').hidden = false;
  $('#loading').hidden = true;
}
