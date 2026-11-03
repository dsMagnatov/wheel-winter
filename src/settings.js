import scenePreset from './scene-preset.json' with { type: 'json' };

export const factoryDefaults = {
  snowColor:'#e7ebf2', snowGrain:0.012, snowScale:46, snowRoughness:0.88, snowSparkle:0.3, snowRelief:0.4, hillHeight:1,
  snowTextureMix:1, snowTextureRotation:0, snowCover:0.75, snowDepth:0.025,
  rockColor:'#568dc9', rockRoughness:0.8, rockBump:0.05, rockTextureScale:1, rockIce:0.32,
  snowfall:8, flakeSize:0.055, fallSpeed:1.25, windSpeed:2.2, windDirection:-15, windVeil:0.5, veilScale:0.6, fog:0.025,
  cloudDensity:0.82, cloudContrast:0.78, cloudSpeed:0.18,
  upperCloudDensity:0.55, upperCloudHeight:3.5, upperCloudScale:1,
  lowerCloudDensity:0.8, lowerCloudHeight:-3, lowerCloudScale:1,
  layerCloudSpeed:0.35, layerCloudSoftness:0.65, layerCloudColor:'#aec6d8',
  lensEnabled:true, lensBlur:8, lensRadius:0.55, lensSoftness:0.45,
  lensCenterX:0.5, lensCenterY:0.5, lensAspect:1.4, lensVignette:0.18, lensChromatic:0.15,
  spinEnabled:true, spinZoom:43, spinRPMResponse:90, spinAttack:0.125, spinRelease:0.2,
  spinSceneTwist:9.75, spinSceneBlur:1,
  spinTextWarp:46, spinTextWave:1, spinTextMotion:1, spinTextBlur:0.75,
  sunIntensity:3.1, sunAzimuth:-38, sunElevation:48, sunColor:'#e7f5ff', ambientIntensity:0.55, ambientColor:'#a8c4dd', fillIntensity:1.8, rimIntensity:4.3, exposure:0.96, shadowSoftness:3, shadowOpacity:0.45, skyColor:'#162c3e', horizonColor:'#6f91a9', backgroundLight:0.85,
  rpm:160, scrollSensitivity:1, scrollInertia:1.35,
  accumulationEnabled:true, accumulationRate:1, accumulationMax:0.12, snowAdhesion:0.65, snowShedding:1,
  autoEscape:false, sinkDepth:1.45, sinkSpeed:0.7, jumpHeight:1.8, escapeInterval:6.5, wheelScale:1, wheelYaw:32, wheelTilt:24, wheelPitch:-12, wheelX:0, wheelZ:0,
  sprayAmount:9, spraySpread:1.8, spraySize:1.15, spraySpeed:1, sprayLifetime:1.8,
  sprayLift:1.7, sprayGravity:5.4, sprayMist:0.12, sprayTurbulence:0.7,
  parallaxEnabled:true, parallaxAmount:0.8, parallaxSmoothing:4,
  rubberColor:'#11151b', rubberRoughness:0.78, rubberMetalness:0.02, rubberBump:0.018, rubberTextureScale:1, rubberTextureRotation:0, rubberTextureMix:1, treadDepth:0.055, treadSnow:0.08,
  rimColor:'#b8a06a', rimRoughness:0.28, rimMetalness:0.94, rimBump:0.004, rimTextureScale:1, rimTextureRotation:0, rimTextureMix:1, spokeStyle:5, rimFinish:'brushed',
};

export function sanitizeSettings(input) {
  const result={};
  for(const [key,fallback] of Object.entries(factoryDefaults)) {
    if(typeof input?.[key]===typeof fallback) {
      if(typeof fallback==='number' && Number.isFinite(input[key])) result[key]=input[key];
      if(typeof fallback==='boolean') result[key]=input[key];
      if(typeof fallback==='string' && (/^#[\da-f]{6}$/i.test(input[key]) || ['brushed','polished','matte'].includes(input[key]))) result[key]=input[key];
    }
  }
  return result;
}

export const defaults = { ...factoryDefaults, ...sanitizeSettings(scenePreset) };
