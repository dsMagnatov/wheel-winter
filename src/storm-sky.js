import * as THREE from 'three';

const noise=`float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}float fBm(vec2 p){float n=0.;float a=.5;mat2 m=mat2(.8,-.6,.6,.8);for(int i=0;i<6;i++){n+=a*n2(p);p=m*p*2.05+vec2(4.3,1.9);a*=.5;}return n;}`;
export function createStormSky(settings,time){
  const uniforms={top:{value:new THREE.Color(settings.skyColor)},bottom:{value:new THREE.Color(settings.horizonColor)},brightness:{value:settings.backgroundLight},cloudDensity:{value:settings.cloudDensity},cloudContrast:{value:settings.cloudContrast},cloudSpeed:{value:settings.cloudSpeed},windVeil:{value:settings.windVeil},windSpeed:{value:settings.windSpeed},veilScale:{value:settings.veilScale},uTime:time,uPlate:{value:new THREE.Texture()},uHasPlate:{value:0},uAspect:{value:innerWidth/innerHeight}};
  const group=new THREE.Group();
  uniforms.uAnalysis={value:0};
  const material=new THREE.ShaderMaterial({depthWrite:false,depthTest:false,uniforms,
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,.99999,1.);}',
    fragmentShader:`varying vec2 vUv;uniform vec3 top;uniform vec3 bottom;uniform float brightness;uniform float cloudDensity;uniform float cloudContrast;uniform float cloudSpeed;uniform float uTime;uniform sampler2D uPlate;uniform float uHasPlate;uniform float uAspect;uniform float uAnalysis;${noise}
    void main(){float t=uTime*cloudSpeed;vec2 uv=vUv-.5;float sourceAspect=1672./941.;if(uAspect>sourceAspect)uv.y*=sourceAspect/uAspect;else uv.x*=uAspect/sourceAspect;uv+=.5;
    float cloudMask=smoothstep(.48,.70,uv.y);
    vec2 cloudUv=uv;cloudUv.x=.5+(cloudUv.x-.5)*.84;
    vec2 drift=vec2(t*.028,sin(t*.20)*.006);
    vec2 curl=vec2(fBm(uv*vec2(3.,2.)+vec2(t*.06,0.)),fBm(uv*vec2(2.3,3.1)-vec2(0.,t*.04)))-.5;
    cloudUv+=drift+curl*.017*sin(t*.29);
    // Raise the distant right ridge while keeping the moving sky on its own UVs.
    float rightRise=.095*smoothstep(.52,.82,uv.x)*(1.-smoothstep(.49,.64,uv.y));
    vec3 stillPlate=texture2D(uPlate,clamp(uv-vec2(0.,rightRise),.001,.999)).rgb;
    vec3 movingClouds=texture2D(uPlate,vec2(cloudUv.x,clamp(cloudUv.y,.001,.999))).rgb;
    vec3 plate=mix(stillPlate,movingClouds,cloudMask);
    // Sample a second flank from the same snowy plate and fade it into the valley mist.
    vec2 leftUv=vec2(.995-vUv.x*.55,(vUv.y-.25)*.82);
    leftUv.y+=.10*(1.-smoothstep(.31,.56,vUv.y));
    vec3 leftRidge=texture2D(uPlate,clamp(leftUv,.001,.999)).rgb;
    float leftCrest=.31+.16*smoothstep(.64,.995,leftUv.x);
    float leftRidgeMask=(1.-smoothstep(.41,.58,vUv.x))*smoothstep(.11,.25,vUv.y)*(1.-smoothstep(leftCrest-.006,leftCrest+.035,leftUv.y));
    plate=mix(plate,leftRidge,leftRidgeMask*.92);
    vec3 gradient=mix(bottom,top,smoothstep(0.,1.,vUv.y));vec3 col=mix(gradient,plate,uHasPlate*smoothstep(0.,.5,cloudDensity));col=(col-.18)*(1.+(cloudContrast-.78)*.7)+.18;float passing=fBm(vUv*vec2(4.,2.)-vec2(t*.12,0.));col*=1.-smoothstep(.48,.8,passing)*cloudDensity*.10;col=mix(col,col*(top*2.+vec3(.75)),.09);
    vec2 scanUv=(vUv-vec2(.5,.46))*vec2(uAspect,1.);
    float halo=exp(-dot(scanUv,scanUv)*5.);
    vec3 stormColor=max(col,0.)*brightness;
    vec3 catalogSky=stormColor*vec3(.78,.89,1.02)+vec3(.012,.025,.043)*halo;
    gl_FragColor=vec4(mix(stormColor,catalogSky,uAnalysis),1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`});
  const sky=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);sky.frustumCulled=false;sky.renderOrder=-100;group.add(sky);
  const ready=new Promise((resolve,reject)=>new THREE.TextureLoader().load('/textures/storm-background.png',texture=>{texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=THREE.MirroredRepeatWrapping;uniforms.uPlate.value=texture;uniforms.uHasPlate.value=1;resolve();},undefined,reject));
  return {group,sky,uniforms,ready};
}
