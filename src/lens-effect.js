import * as THREE from 'three';

const DEFAULTS = {
  lensEnabled: true,
  lensBlur: 8,
  lensRadius: 0.55,
  lensSoftness: 0.45,
  lensCenterX: 0.5,
  lensCenterY: 0.5,
  lensAspect: 1.4,
  lensVignette: 0.18,
  lensChromatic: 0.15,
};

const CATALOG_LENS = {
  lensBlur: 9,
  lensRadius: .95,
  lensSoftness: 1,
  lensCenterX: .78,
  lensCenterY: .615,
  lensAspect: 1.34,
};

const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = `
uniform sampler2D tScene;
uniform sampler2D tBlur;
uniform vec2 uInverseSize;
uniform vec2 uHalfTexel;
uniform vec2 uBlurHalfTexel;
uniform vec2 uCenter;
uniform float uViewportAspect;
uniform float uAspect;
uniform float uRadius;
uniform float uSoftness;
uniform float uBlur;
uniform float uVignette;
uniform float uChromatic;
uniform float uLensEnabled;
uniform float uSpinStrength;
uniform vec2 uSpinCenter;
uniform float uSpinTwist;
uniform float uSpinBlur;
varying vec2 vUv;

vec2 spinSampleUv(vec2 uv) {
  // Reflect samples beyond the frame so twisting does not stretch the last pixel.
  return uSpinStrength > 0.0 ? 1.0 - abs(mod(uv, 2.0) - 1.0) : uv;
}

vec3 readScene(vec2 uv) {
  return texture2D(tScene, clamp(spinSampleUv(uv), uHalfTexel, 1.0 - uHalfTexel)).rgb;
}

vec3 readLens(vec2 uv, float blurMix) {
  vec3 sharp = readScene(uv);
  if (blurMix < 0.0001) return sharp;
  vec3 soft = texture2D(tBlur, clamp(spinSampleUv(uv), uBlurHalfTexel, 1.0 - uBlurHalfTexel)).rgb;
  return mix(sharp, soft, blurMix);
}

void main() {
  vec2 centered = (vUv - uCenter) * 2.0;
  centered.x *= uViewportAspect / uAspect;
  float distanceFromCenter = length(centered);
  float edge = smoothstep(uRadius, uRadius + uSoftness, distanceFromCenter) * uLensEnabled;
  vec2 sampleUv = vUv;
  vec2 spinTrail = vec2(0.0);
  float spinMix = 0.0;

  if (uSpinStrength > 0.0) {
    vec2 radial = (vUv - uSpinCenter) * vec2(uViewportAspect, 1.0);
    float radius = length(radial);
    float peripheral = smoothstep(0.28, 0.65, radius);
    spinMix = uSpinStrength * peripheral;
    float focusBlend = smoothstep(0.0, 0.35, uSpinStrength);
    edge *= mix(1.0, smoothstep(0.28, 0.48, radius), focusBlend);
    if (spinMix > 0.0001) {
      // Work in screen pixels so the twist follows a circle on wide displays.
      float turn = spinMix * uSpinTwist;
      float c = cos(turn), s = sin(turn);
      vec2 twisted = mat2(c, s, -s, c) * radial;
      vec2 uvScale = vec2(1.0 / uViewportAspect, 1.0);
      sampleUv = uSpinCenter + twisted * uvScale;
      spinTrail = vec2(-twisted.y, twisted.x) * uvScale * spinMix * (0.058 * uSpinBlur);
    }
  }

  vec3 color = readScene(sampleUv);

  // The focal area is untouched. Only the surrounding lens frame softens.
  if (edge > 0.0001) {
    float blurMix = edge * smoothstep(0.0, 2.0, uBlur);
    color = readLens(sampleUv, blurMix);
    if (uChromatic > 0.001) {
      vec2 pixelDirection = (vUv - uCenter) / uInverseSize;
      pixelDirection /= max(length(pixelDirection), 0.0001);
      vec2 fringe = pixelDirection * uInverseSize * uChromatic * edge * edge;
      color.r = readLens(sampleUv + fringe, blurMix).r;
      color.b = readLens(sampleUv - fringe, blurMix).b;
    }
  }

  if (spinMix * uSpinBlur > 0.0001) {
    vec3 trail = readScene(sampleUv + spinTrail) + readScene(sampleUv - spinTrail);
    trail += 2.0 * (readScene(sampleUv + spinTrail * 0.45) + readScene(sampleUv - spinTrail * 0.45));
    color = mix(color, (color * 3.0 + trail) / 9.0, smoothstep(0.0, 0.35, spinMix * uSpinBlur));
  }
  color *= 1.0 - uVignette * edge * edge * 0.9;

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const downsampleShader = `
uniform sampler2D tInput;
uniform vec2 uStep;
uniform vec2 uHalfTexel;
varying vec2 vUv;
vec3 readInput(vec2 uv) {
  return texture2D(tInput, clamp(uv, uHalfTexel, 1.0 - uHalfTexel)).rgb;
}
void main() {
  // Prefilter before reducing resolution, avoiding repeated high-contrast edges.
  vec3 color = readInput(vUv + uStep * vec2(-0.5, -0.5));
  color += readInput(vUv + uStep * vec2(0.5, -0.5));
  color += readInput(vUv + uStep * vec2(-0.5, 0.5));
  color += readInput(vUv + uStep * vec2(0.5, 0.5));
  gl_FragColor = vec4(color * 0.25, 1.0);
}
`;

const gaussianShader = `
uniform sampler2D tInput;
uniform vec2 uDirection;
uniform vec2 uHalfTexel;
uniform float uCenterWeight;
uniform float uWeights[6];
uniform float uOffsets[6];
varying vec2 vUv;
vec3 readInput(vec2 uv) {
  return texture2D(tInput, clamp(uv, uHalfTexel, 1.0 - uHalfTexel)).rgb;
}
void main() {
  vec3 color = readInput(vUv) * uCenterWeight;
  // Adjacent Gaussian weights share a bilinear read: 25 samples in 13 fetches.
  for (int i = 0; i < 6; i++) {
    vec2 offset = uDirection * uOffsets[i];
    color += (readInput(vUv + offset) + readInput(vUv - offset)) * uWeights[i];
  }
  gl_FragColor = vec4(color, 1.0);
}
`;

function setting(settings, key, min, max) {
  const value = Number(settings[key] ?? DEFAULTS[key]);
  return THREE.MathUtils.clamp(Number.isFinite(value) ? value : DEFAULTS[key], min, max);
}

/** A linear-light render pass with a sharp, adjustable elliptical focal area. */
export class LensEffect {
  constructor(renderer, settings = {}) {
    this.renderer = renderer;
    this.width = 1;
    this.height = 1;
    this.pixelRatio = 1;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: renderer.extensions.has('EXT_color_buffer_float')
        ? THREE.HalfFloatType
        : THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: true,
      generateMipmaps: false,
    });
    this.target.texture.name = 'LensEffect.LinearScene';
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.target.samples = Math.min(4, renderer.capabilities.maxSamples || 0);
    const blurOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: this.target.texture.type,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    this.blurTargetA = new THREE.WebGLRenderTarget(1, 1, blurOptions);
    this.blurTargetB = new THREE.WebGLRenderTarget(1, 1, blurOptions);
    for (const [index, target] of [this.blurTargetA, this.blurTargetB].entries()) {
      target.texture.name = `LensEffect.LinearBlur${index}`;
      target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    }

    this.uniforms = {
      tScene: { value: this.target.texture },
      tBlur: { value: this.blurTargetA.texture },
      uInverseSize: { value: new THREE.Vector2(1, 1) },
      uHalfTexel: { value: new THREE.Vector2(0.5, 0.5) },
      uBlurHalfTexel: { value: new THREE.Vector2(0.5, 0.5) },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uViewportAspect: { value: 1 },
      uAspect: { value: DEFAULTS.lensAspect },
      uRadius: { value: DEFAULTS.lensRadius },
      uSoftness: { value: DEFAULTS.lensSoftness },
      uBlur: { value: DEFAULTS.lensBlur },
      uVignette: { value: DEFAULTS.lensVignette },
      uChromatic: { value: DEFAULTS.lensChromatic },
      uLensEnabled: { value: 1 },
      uSpinStrength: { value: 0 },
      uSpinCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uSpinTwist: { value: 0.17 },
      uSpinBlur: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      name: 'PeripheralLensEffect',
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: true,
    });
    const intermediateOptions = {
      vertexShader,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    };
    this.downsampleMaterial = new THREE.ShaderMaterial({
      ...intermediateOptions,
      name: 'LensDownsample',
      fragmentShader: downsampleShader,
      uniforms: {
        tInput: { value: this.target.texture },
        uStep: { value: new THREE.Vector2(1, 1) },
        uHalfTexel: this.uniforms.uHalfTexel,
      },
    });
    this.gaussianMaterial = new THREE.ShaderMaterial({
      ...intermediateOptions,
      name: 'LensSeparableGaussian',
      fragmentShader: gaussianShader,
      uniforms: {
        tInput: { value: null },
        uDirection: { value: new THREE.Vector2() },
        uHalfTexel: this.uniforms.uBlurHalfTexel,
        uCenterWeight: { value: 1 },
        uWeights: { value: new Float32Array(6) },
        uOffsets: { value: new Float32Array(6) },
      },
    });
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(this.geometry, this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const size = renderer.getSize(new THREE.Vector2());
    this.resize(size.x, size.y, renderer.getPixelRatio());
    this.update(settings);
  }

  update(settings = {}, catalogBlend = 0) {
    const uniforms = this.uniforms;
    const blend = (key, min, max) =>
      THREE.MathUtils.lerp(setting(settings, key, min, max), CATALOG_LENS[key], catalogBlend);
    const stormEnabled = settings.lensEnabled ?? DEFAULTS.lensEnabled;
    uniforms.uLensEnabled.value = stormEnabled ? 1 : catalogBlend;
    this.enabled = uniforms.uLensEnabled.value > 0;
    uniforms.uBlur.value = blend('lensBlur', 0, 24);
    uniforms.uRadius.value = blend('lensRadius', 0.1, 1.4);
    uniforms.uSoftness.value = blend('lensSoftness', 0.01, 1);
    uniforms.uAspect.value = blend('lensAspect', 0.3, 3);
    uniforms.uVignette.value = setting(settings, 'lensVignette', 0, 1);
    uniforms.uChromatic.value = setting(settings, 'lensChromatic', 0, 3);
    // UI coordinates start at the top left; texture coordinates at bottom left.
    uniforms.uCenter.value.set(
      blend('lensCenterX', 0, 1),
      1 - blend('lensCenterY', 0, 1),
    );
    this.updateKernel();
  }

  setSpinEffect(strength, centerX, centerY, twist, blur) {
    this.uniforms.uSpinStrength.value = twist || blur ? strength : 0;
    this.uniforms.uSpinCenter.value.set(centerX, centerY);
    this.uniforms.uSpinTwist.value = twist;
    this.uniforms.uSpinBlur.value = blur;
  }

  updateKernel() {
    if (this.kernelRadius === this.uniforms.uBlur.value) return;
    this.kernelRadius = this.uniforms.uBlur.value;
    // Half-resolution pixels are two CSS pixels; radius spans three sigma.
    const sigma = Math.max(this.uniforms.uBlur.value / 6, 0.0001);
    const weights = Array.from({ length: 13 }, (_, i) => Math.exp(-(i * i) / (2 * sigma * sigma)));
    const total = weights[0] + 2 * weights.slice(1).reduce((sum, weight) => sum + weight, 0);
    const uniforms = this.gaussianMaterial.uniforms;
    uniforms.uCenterWeight.value = weights[0] / total;
    for (let pair = 0; pair < 6; pair++) {
      const index = pair * 2 + 1;
      const pairWeight = weights[index] + weights[index + 1];
      uniforms.uWeights.value[pair] = pairWeight / total;
      uniforms.uOffsets.value[pair] = pairWeight > 0
        ? (index * weights[index] + (index + 1) * weights[index + 1]) / pairWeight
        : index;
    }
  }

  resize(width, height, pixelRatio = this.renderer.getPixelRatio()) {
    this.width = Math.max(1, Number(width) || 1);
    this.height = Math.max(1, Number(height) || 1);
    this.pixelRatio = THREE.MathUtils.clamp(Number(pixelRatio) || 1, 0.5, 1.5);
    const targetWidth = Math.max(1, Math.round(this.width * this.pixelRatio));
    const targetHeight = Math.max(1, Math.round(this.height * this.pixelRatio));
    this.target.setSize(targetWidth, targetHeight);
    const blurWidth = Math.max(1, Math.ceil(this.width * 0.5));
    const blurHeight = Math.max(1, Math.ceil(this.height * 0.5));
    this.blurTargetA.setSize(blurWidth, blurHeight);
    this.blurTargetB.setSize(blurWidth, blurHeight);
    this.uniforms.uInverseSize.value.set(1 / this.width, 1 / this.height);
    this.uniforms.uHalfTexel.value.set(0.5 / targetWidth, 0.5 / targetHeight);
    this.uniforms.uBlurHalfTexel.value.set(0.5 / blurWidth, 0.5 / blurHeight);
    this.uniforms.uViewportAspect.value = this.width / this.height;
    this.downsampleMaterial.uniforms.uStep.value.set(1 / blurWidth, 1 / blurHeight);
  }

  render(scene, camera) {
    const uniforms = this.uniforms;
    const useLens = this.enabled && (
      uniforms.uBlur.value > 0 ||
      uniforms.uVignette.value > 0 ||
      uniforms.uChromatic.value > 0
    );
    if (!useLens && uniforms.uSpinStrength.value === 0) {
      this.renderer.render(scene, camera);
      return;
    }

    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    try {
      renderer.autoClear = false;
      renderer.setRenderTarget(this.target);
      renderer.clear(true, true, true);
      // Three.js keeps ordinary render targets linear and skips tone mapping.
      renderer.render(scene, camera);
      if (useLens && uniforms.uBlur.value > 0.01) {
        this.quad.material = this.downsampleMaterial;
        renderer.setRenderTarget(this.blurTargetA);
        renderer.render(this.scene, this.camera);

        this.quad.material = this.gaussianMaterial;
        const blurUniforms = this.gaussianMaterial.uniforms;
        blurUniforms.tInput.value = this.blurTargetA.texture;
        blurUniforms.uDirection.value.set(1 / this.blurTargetA.width, 0);
        renderer.setRenderTarget(this.blurTargetB);
        renderer.render(this.scene, this.camera);

        blurUniforms.tInput.value = this.blurTargetB.texture;
        blurUniforms.uDirection.value.set(0, 1 / this.blurTargetB.height);
        renderer.setRenderTarget(this.blurTargetA);
        renderer.render(this.scene, this.camera);
      }
      this.quad.material = this.material;
      renderer.setRenderTarget(previousTarget);
      // Tone mapping and output conversion happen once, in this final pass.
      renderer.render(this.scene, this.camera);
    } finally {
      this.quad.material = this.material;
      renderer.setRenderTarget(previousTarget);
      renderer.autoClear = previousAutoClear;
    }
  }

  dispose() {
    this.target.dispose();
    this.blurTargetA.dispose();
    this.blurTargetB.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.downsampleMaterial.dispose();
    this.gaussianMaterial.dispose();
    this.scene.clear();
  }
}
