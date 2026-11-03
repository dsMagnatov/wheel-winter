import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const finite = (value, fallback, min, max) => Number.isFinite(value) ? clamp(value, min, max) : fallback;

const CLOUD_NOISE = `
float layerHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float layerNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(layerHash(i),layerHash(i+vec2(1.,0.)),f.x),mix(layerHash(i+vec2(0.,1.)),layerHash(i+vec2(1.)),f.x),f.y);
}
float layerFbm(vec2 p){
  float value=0.,weight=.5;mat2 turn=mat2(.8,-.6,.6,.8);
  for(int i=0;i<5;i++){value+=weight*layerNoise(p);p=turn*p*2.03+vec2(3.7,6.1);weight*=.5;}
  return value;
}
`;

/**
 * World-space cloud banks composited over the cliffs. The wheel writes a
 * silhouette into stencil, so passing clouds leave the actual product clear.
 */
export function createCloudLayers({ settings = {}, time = { value: 0 } } = {}) {
  const group = new THREE.Group();
  group.name = 'Upper and lower atmospheric cloud banks';
  const uniforms = {
    uLayerTime: time,
    uLayerSpeed: { value: .35 },
    uLayerSoftness: { value: .65 },
    uLayerColor: { value: new THREE.Color('#aec6d8') },
    uLayerWind: { value: new THREE.Vector2(1, 0) },
    upperDensity: { value: .55 },
    lowerDensity: { value: .8 },
  };

  const definitions = [
    { bank: 'upper', z: -11, width: 44, height: 9, offsetY: .2, offsetX: -1.0, phase: 3.1, weight: .60, flow: .065 },
    { bank: 'upper', z: -18, width: 62, height: 13, offsetY: 1.2, offsetX: 2.0, phase: 17.4, weight: .38, flow: .043 },
    { bank: 'lower', z: -7, width: 35, height: 7, offsetY: -.5, offsetX: -.8, phase: 29.2, weight: .72, flow: .092 },
    { bank: 'lower', z: -13, width: 50, height: 10, offsetY: -1.2, offsetX: 1.7, phase: 43.8, weight: .45, flow: .065 },
    { bank: 'lower', z: -23, width: 72, height: 15, offsetY: -2.1, offsetX: -2.4, phase: 61.3, weight: .25, flow: .041 },
  ];

  const meshes = definitions.map(definition => {
    const density = definition.bank === 'upper' ? uniforms.upperDensity : uniforms.lowerDensity;
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
      side: THREE.DoubleSide,
      uniforms: {
        ...uniforms,
        uLayerDensity: density,
        uLayerPhase: { value: definition.phase },
        uLayerWeight: { value: definition.weight },
        uLayerFlow: { value: definition.flow },
        uLayerLower: { value: definition.bank === 'lower' ? 1 : 0 },
      },
      vertexShader: `
        varying vec2 vLayerUv;
        void main(){
          vLayerUv=uv;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
        }
      `,
      fragmentShader: `
        varying vec2 vLayerUv;
        uniform float uLayerTime;
        uniform float uLayerSpeed;
        uniform float uLayerSoftness;
        uniform vec3 uLayerColor;
        uniform vec2 uLayerWind;
        uniform float uLayerDensity;
        uniform float uLayerPhase;
        uniform float uLayerWeight;
        uniform float uLayerFlow;
        uniform float uLayerLower;
        ${CLOUD_NOISE}
        void main(){
          vec2 uv=vLayerUv;
          float t=uLayerTime*uLayerSpeed*uLayerFlow;
          vec2 p=uv*vec2(5.2,2.25)+vec2(uLayerPhase,uLayerPhase*.37);
          p-=uLayerWind*t;
          vec2 warp=vec2(layerFbm(p*.76+vec2(0.,t*.16)),layerFbm(p*.81+vec2(8.,-t*.12)))-.5;
          float bulk=layerFbm(p+warp*1.65);
          float detail=layerFbm(p*2.65+warp*.5);
          float field=bulk*.82+detail*.18;

          // Soft edges avoid a rectangular cloud sheet. The lower banks retain
          // more mass toward their base; upper banks feather down into the sky.
          float vertical=exp(-pow((uv.y-.50)/.34,2.)*1.35);
          float sideFade=smoothstep(0.,.12,uv.x)*(1.-smoothstep(.88,1.,uv.x));
          float edgeFade=smoothstep(0.,.10,uv.y)*(1.-smoothstep(.90,1.,uv.y));
          float thresholdLow=mix(.43,.30,uLayerSoftness);
          float thresholdHigh=mix(.57,.73,uLayerSoftness);
          float body=smoothstep(thresholdLow,thresholdHigh,field);
          float base=1.+uLayerLower*(1.-uv.y)*.24;
          float opticalDepth=body*vertical*base*uLayerDensity*uLayerWeight*2.15;
          float alpha=(1.-exp(-opticalDepth))*sideFade*edgeFade;
          if(alpha<.001)discard;

          float edgeLight=smoothstep(.48,.74,field)*.26;
          vec3 color=uLayerColor*(.76+bulk*.27+edgeLight);
          gl_FragColor=vec4(color,clamp(alpha,0.,.84));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(definition.width, definition.height), material);
    mesh.name = `${definition.bank === 'upper' ? 'Upper' : 'Lower'} cloud bank at ${definition.z}`;
    mesh.position.z = definition.z;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 10;
    mesh.userData.cloudBank = definition.bank;
    mesh.userData.cloudLayerDepth = definition.z;
    group.add(mesh);
    return mesh;
  });

  let catalogBlend = 0;

  function setCatalogBlend(blend) {
    catalogBlend = blend;
    const upperDensity = finite(settings.upperCloudDensity, .55, 0, 2);
    const lowerDensity = finite(settings.lowerCloudDensity, .8, 0, 2);
    uniforms.upperDensity.value = upperDensity * (1 - .18 * blend);
    uniforms.lowerDensity.value = lowerDensity * (1 - .34 * blend);
    definitions.forEach((definition, index) => {
      const upper = definition.bank === 'upper';
      const mesh = meshes[index];
      const height = upper ? finite(settings.upperCloudHeight, 3.5, -1, 9) : finite(settings.lowerCloudHeight, -3, -9, 1);
      const stormY = height + definition.offsetY * mesh.scale.y;
      // Keep the banks near the frame edges as the camera moves into the catalog.
      const catalogY = .3 + (upper ? .27 : -.27) * (7.9 - definition.z);
      mesh.position.y = THREE.MathUtils.lerp(stormY, catalogY, blend);
      mesh.visible = (upper ? upperDensity : lowerDensity) > 0;
    });
  }

  function update(next = settings) {
    settings = next;
    uniforms.uLayerSpeed.value = finite(next.layerCloudSpeed, .35, 0, 3);
    uniforms.uLayerSoftness.value = finite(next.layerCloudSoftness, .65, 0, 1);
    uniforms.uLayerColor.value.set(/^#[0-9a-f]{6}$/i.test(next.layerCloudColor || '') ? next.layerCloudColor : '#aec6d8');
    const direction = THREE.MathUtils.degToRad(finite(next.windDirection, -15, -360, 360));
    uniforms.uLayerWind.value.set(Math.cos(direction), Math.sin(direction)*.3);
    definitions.forEach((definition, index) => {
      const upper = definition.bank === 'upper';
      const scale = finite(next[upper ? 'upperCloudScale' : 'lowerCloudScale'], 1, .2, 4);
      const mesh = meshes[index];
      mesh.position.x = definition.offsetX * scale;
      mesh.scale.set(scale, scale, 1);
    });
    setCatalogBlend(catalogBlend);
  }

  update(settings);
  return { group, update, setCatalogBlend };
}
