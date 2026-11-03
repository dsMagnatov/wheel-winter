const DEFAULTS = {
  rpm: 160,
  scrollSensitivity: 1,
  scrollInertia: 1.35,
  scrollEnabled: true,
};

const PIXELS_PER_LINE = 16;
const PIXELS_PER_PAGE = 800;
const MAX_INPUT_PIXELS = 700;
const RPM_PER_PIXEL = 0.16;
const STOP_RPM = 0.12;

export function scrollPixels(delta, mode = 0) {
  const unit = mode === 1 ? PIXELS_PER_LINE : mode === 2 ? PIXELS_PER_PAGE : 1;
  return Math.min(MAX_INPUT_PIXELS, Math.max(-MAX_INPUT_PIXELS, delta * unit));
}

function bounded(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

/** Signed, scroll-driven wheel velocity. Time values are in seconds. */
export class ScrollDrive {
  constructor(settings = {}) {
    this.settings = { ...DEFAULTS };
    this.velocity = 0;
    this.configure(settings);
  }

  get rpm() {
    return this.velocity;
  }

  get energy() {
    return Math.abs(this.velocity) / this.settings.rpm;
  }

  get state() {
    return this.velocity === 0 ? 'idle' : this.velocity > 0 ? 'forward' : 'reverse';
  }

  configure(settings) {
    this.settings.rpm = bounded(settings.rpm, this.settings.rpm, 10, 600);
    this.settings.scrollSensitivity = bounded(settings.scrollSensitivity, this.settings.scrollSensitivity, 0.05, 5);
    this.settings.scrollInertia = bounded(settings.scrollInertia, this.settings.scrollInertia, 0.1, 5);
    if (typeof settings.scrollEnabled === 'boolean') this.settings.scrollEnabled = settings.scrollEnabled;
    this.velocity = this.settings.scrollEnabled
      ? Math.min(this.settings.rpm, Math.max(-this.settings.rpm, this.velocity))
      : 0;
  }

  /** deltaMode follows WheelEvent: 0 = pixels, 1 = lines, 2 = pages. */
  impulse(deltaY, deltaMode = 0) {
    if (!this.settings.scrollEnabled || !Number.isFinite(deltaY)) return this.velocity;
    const pixels = scrollPixels(deltaY, deltaMode);
    if (pixels === 0) return this.velocity;

    // An opposite gesture cancels the old coast before starting the new one.
    if (this.velocity * pixels < 0) this.velocity = 0;
    this.velocity += pixels * RPM_PER_PIXEL * this.settings.scrollSensitivity;
    this.velocity = Math.min(this.settings.rpm, Math.max(-this.settings.rpm, this.velocity));
    return this.velocity;
  }

  /** Advance momentum and optionally apply updated panel settings. */
  update(dt, settings) {
    if (settings) this.configure(settings);
    if (!this.settings.scrollEnabled || this.velocity === 0) return this.velocity;
    if (!Number.isFinite(dt) || dt <= 0) return this.velocity;
    this.velocity *= Math.exp(-dt / this.settings.scrollInertia);
    if (Math.abs(this.velocity) < STOP_RPM) this.velocity = 0;
    return this.velocity;
  }

  /** A single button-driven scroll impulse; a negative value reverses it. */
  kick(deltaY = 420) {
    return this.impulse(deltaY);
  }

  stop() {
    this.velocity = 0;
    return this.velocity;
  }

  reset() {
    return this.stop();
  }
}
