import './preloader.css';

export function startPreloader() {
  const loader = document.getElementById('loading');
  const counter = document.getElementById('loader-count');
  let previousFrame = performance.now();
  let target = 38;
  let shown = 0;

  function tick(now) {
    if (loader.hidden) return;
    shown = Math.min(target, shown + Math.min(now - previousFrame, 32) / 8);
    previousFrame = now;
    const percentage = Math.floor(shown);
    counter.textContent = String(percentage).padStart(2, '0');
    loader.style.setProperty('--load-progress', `${percentage}%`);

    if (shown < 100) {
      requestAnimationFrame(tick);
    } else {
      setTimeout(() => {
        loader.classList.add('loaded');
        setTimeout(() => loader.remove(), 700);
      }, 120);
    }
  }

  requestAnimationFrame(tick);
  return {
    sceneReady() { target = 76; },
    finish() { target = 100; },
  };
}
