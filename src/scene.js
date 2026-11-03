import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createWinterTread, crownRadius, findTreadSupport, makeForgedSpokes } from './wheel-geometry.js';
import { createIcyCliffs } from './icy-cliffs.js';
import { ContactSnow } from './contact-snow.js';
import { createStormSky } from './storm-sky.js';
import { createCloudLayers } from './cloud-layers.js';
import { LensEffect } from './lens-effect.js';
import { ScrollDrive, scrollPixels } from './scroll-drive.js';
import { WheelSnow } from './wheel-snow.js';
import { SettledSnow } from './settled-snow.js';
import { WheelCatalog, catalogCenter, catalogRotation } from './wheel-catalog.js';

const TAU=Math.PI*2;
const rad=THREE.MathUtils.degToRad;
const noiseGLSL=`
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise2(vec2 p){vec2 i=floor(p), f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+vec2(1.)),f.x),f.y);}
float fbm(vec2 p){float a=.5;float n=0.;for(int i=0;i<4;i++){n+=a*noise2(p);p=p*2.03+vec2(2.1,6.3);a*=.5;}return n;}
`;
const hash=(x,y)=>{const n=Math.sin(x*127.1+y*311.7)*43758.5453;return n-Math.floor(n);};
function noise(x,y){const ix=Math.floor(x),iy=Math.floor(y);let fx=x-ix,fy=y-iy;fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy);return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix,iy),hash(ix+1,iy),fx),THREE.MathUtils.lerp(hash(ix,iy+1),hash(ix+1,iy+1),fx),fy);}
function fbm(x,y){let v=0,a=0.5;for(let i=0;i<5;i++){v+=noise(x,y)*a;x=x*2.03+2.1;y=y*2.03+6.3;a*=0.5;}return v;}

function canvasTexture(size,draw,color=false){const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const ctx=canvas.getContext('2d');draw(ctx,size);const t=new THREE.CanvasTexture(canvas);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;if(color)t.colorSpace=THREE.SRGBColorSpace;return t;}
function grainTexture(kind){return canvasTexture(512,(ctx,s)=>{const image=ctx.createImageData(s,s);for(let y=0;y<s;y++)for(let x=0;x<s;x++){let v;if(kind==='metal')v=112+Math.random()*30+Math.sin(y*2)*9;else if(kind==='tread'){const cut=(y%106>96 || (x+Math.sin(y*.08)*9)%63<4);v=cut?45:165+Math.random()*38;}else v=90+Math.random()*110+noise(x*.08,y*.08)*40;const i=(y*s+x)*4;image.data[i]=image.data[i+1]=image.data[i+2]=v;image.data[i+3]=255;}ctx.putImageData(image,0,0);});}
function particleTexture(){return canvasTexture(64,(ctx,s)=>{const g=ctx.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.25,'rgba(255,255,255,.9)');g.addColorStop(.65,'rgba(255,255,255,.25)');g.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=g;ctx.fillRect(0,0,s,s);});}

export class WinterScene{
  constructor(canvas,settings,onState,products,catalogUI){
    this.settings=settings;this.onState=onState;this.time=0;this.paused=false;this.panelVisible=true;this.depth=0;this.jumpTime=-1;this.cycle=0;this.previousNow=performance.now();this.lastState='';this.textureNames={snow:{},rubber:{},rim:{}};this.customTextures={snow:{},rubber:{},rim:{}};
    this.drive=new ScrollDrive(settings);this.motorRPM=0;
    this.scanTurns=0;
    this.spinEffect=0;
    this.stage='storm';
    this.launchProgress=0;
    this.launchPosition=new THREE.Vector3();
    this.launchRotation=new THREE.Quaternion();
    this.catalogEntryPosition=catalogCenter.clone();
    this.catalogEntryRotation=catalogRotation.clone();
    this.catalogEntryScale=settings.wheelScale;
    this.spinFocus=new THREE.Vector3();
    this.spinViewport=canvas.parentElement;
    this.scanTurnsLabel=this.spinViewport.querySelector('#scan-turns');
    this.scanFrequencyLabel=this.spinViewport.querySelector('#scan-frequency');
    this.spinTextDisplacement=document.getElementById('spin-text-displacement');
    this.spinTextWave=document.getElementById('spin-text-wave');
    this.reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,stencil:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.75));this.renderer.setSize(innerWidth,innerHeight);
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.lens=new LensEffect(this.renderer,settings);
    this.scene=new THREE.Scene();this.scene.fog=new THREE.FogExp2(0xcbd5e2,settings.fog);
    this.camera=new THREE.PerspectiveCamera(40,innerWidth/innerHeight,.1,240);
    this.cameraDistance=11.8;
    this.controls=new OrbitControls(this.camera,canvas);this.controls.enabled=false;this.controls.enableZoom=false;this.controls.enablePan=false;this.controls.enableRotate=false;this.controls.minDistance=this.cameraDistance;this.controls.maxDistance=this.cameraDistance;this.controls.minPolarAngle=.45;this.controls.maxPolarAngle=Math.PI*.55;
    this.cursor=new THREE.Vector2();this.parallax=new THREE.Vector2();this.neutralParallax=new THREE.Vector2();this.cameraSpherical=new THREE.Spherical();
    canvas.addEventListener('pointermove',event=>{if(event.pointerType==='touch')return;const width=innerWidth-(this.panelVisible?358:0);this.cursor.set(THREE.MathUtils.clamp(event.clientX/width*2-1,-1,1),THREE.MathUtils.clamp(event.clientY/innerHeight*2-1,-1,1));});
    canvas.addEventListener('pointerleave',()=>this.cursor.set(0,0));
    canvas.addEventListener('wheel',event=>{
      if(event.ctrlKey||event.metaKey)return;
      event.preventDefault();
      const delta=event.deltaY||event.deltaX;
      if(this.stage==='catalog'){
        if(delta&&event.timeStamp-(this.lastCatalogWheel??-Infinity)>380){
          this.catalog.move(Math.sign(delta));
          this.lastCatalogWheel=event.timeStamp;
        }
        return;
      }
      if(this.paused||this.stage!=='storm'||!delta)return;
      this.drive.configure(this.settings);
      const speed=this.drive.impulse(delta,event.deltaMode);
      if(!this.panelVisible)this.advanceLaunchGesture(speed,scrollPixels(delta,event.deltaMode),event.timeStamp);
    },{passive:false});
    this.resetCamera();
    const pmrem=new THREE.PMREMGenerator(this.renderer);const room=new RoomEnvironment();this.environment=pmrem.fromScene(room,.035).texture;this.scene.environment=this.environment;room.dispose();pmrem.dispose();
    this.uniforms={uTime:{value:0},uVeil:{value:settings.windVeil},uWind:{value:new THREE.Vector2(1,0)},uWindSpeed:{value:settings.windSpeed},uVeilScale:{value:settings.veilScale},uSparkle:{value:settings.snowSparkle},uGrain:{value:settings.snowGrain},uGrainScale:{value:settings.snowScale},uTextureMix:{value:1},uWindTexture:{value:new THREE.Texture()},uHasWindTexture:{value:0},uTerrainLight:{value:.7}};
    this.makeSky();this.makeLights();this.makeTerrain();this.makeWheel();this.makeSnow();this.makeSpray();this.makeContactShadow();this.update();
    this.settledSnow=new SettledSnow({scene:this.scene,cliffs:this.cliffs,settings});
    this.wheelSnow=new WheelSnow({wheelRoot:this.wheelRoot,wheelSpin:this.wheelSpin,settings,onShed:particle=>this.settledSnow.emit(particle)});
    this.catalog=new WheelCatalog(this.wheelRoot,this.rimMaterial,this.rimEdgeMaterial,products,catalogUI.select,catalogUI.setMoving);
    this.bindScenePointer(canvas);
    this.resize=()=>{this.renderer.setSize(innerWidth,innerHeight);this.lens.resize(innerWidth,innerHeight,this.renderer.getPixelRatio());this.camera.aspect=innerWidth/innerHeight;this.skyUniforms.uAspect.value=this.camera.aspect;this.adjustView();};window.addEventListener('resize',this.resize);this.adjustView();
    this.renderer.setAnimationLoop(this.animate.bind(this));
    this.ready=Promise.all([this.cliffs.ready,this.skyReady]);
  }
  resetCamera(){this.camera.position.set(0,.3,this.cameraDistance);this.controls.target.set(0,.3,0);this.controls.update();const sphere=new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));this.baseAzimuth=sphere.theta;this.basePolar=sphere.phi;this.cursor?.set(0,0);this.parallax?.set(0,0);}
  adjustView(){
    const width=innerWidth,height=innerHeight,aspect=width/height;
    const desktopFov=Math.min(40,THREE.MathUtils.radToDeg(2*Math.atan(7.2/(this.cameraDistance*aspect))));
    const portraitFov=THREE.MathUtils.radToDeg(2*Math.atan(.245/aspect));
    this.camera.fov=Math.max(desktopFov,Math.min(75,portraitFov));
    this.camera.setViewOffset(width,height,this.panelVisible?179:0,-10,width,height);
    this.camera.updateProjectionMatrix();
  }
  setPanelVisible(visible){this.panelVisible=visible;this.launchGesture=null;this.adjustView();}
  makeSky(){
    const storm=createStormSky(this.settings,this.uniforms.uTime);this.skyUniforms=storm.uniforms;this.sky=storm.sky;this.skyReady=storm.ready;this.scene.add(storm.group);
    this.cloudLayers=createCloudLayers({settings:this.settings,time:this.uniforms.uTime});this.scene.add(this.cloudLayers.group);
  }
  makeLights(){
    this.ambient=new THREE.HemisphereLight(0xd5e4fa,0x526070,1.35);this.scene.add(this.ambient);
    this.sun=new THREE.DirectionalLight(0xe9efff,3.8);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);Object.assign(this.sun.shadow.camera,{left:-18,right:18,top:18,bottom:-18,near:.1,far:80});this.sun.shadow.normalBias=.035;this.sun.shadow.bias=-.0002;this.scene.add(this.sun);this.scene.add(this.sun.target);
    this.fill=new THREE.DirectionalLight(0xd7e5ff,1.8);this.fill.position.set(6,5,8);this.scene.add(this.fill);
    this.rimLight=new THREE.DirectionalLight(0xf0f7ff,3.2);this.rimLight.position.set(-3,5,-4);this.scene.add(this.rimLight);
  }
  terrainHeight(){return this.cliffs?.contactPoint.y??-1.1;}
  makeTerrain(){
    this.snowBump=grainTexture('snow');
    this.groundMaterial=new THREE.MeshStandardMaterial({color:this.settings.snowColor,roughness:.88,bumpMap:this.snowBump,bumpScale:.012});
    this.cliffs=createIcyCliffs({settings:this.settings,uniforms:this.uniforms});this.scene.add(this.cliffs.group);
    // Finish opaque cliff depth before the wheel writes its visible silhouette.
    this.cliffs.group.traverse(mesh=>{if(mesh.isMesh)mesh.renderOrder=-1;});
    for(const material of this.cliffs.snowMaterials)this.installTextureMix(material,'snow');
    this.contactPosition=this.cliffs.contactPoint.clone();this.contactNormal=this.cliffs.contactNormal.clone();this.contactTangent=new THREE.Vector3(-1,.2,0);
  }
  refreshTerrain(){this.cliffs?.update(this.settings);}

  makeWheel(){
    this.wheelRoot=new THREE.Group();this.wheelSpin=new THREE.Group();this.wheelRoot.add(this.wheelSpin);this.scene.add(this.wheelRoot);
    this.rubberBump=grainTexture('rubber');this.rubberBump.repeat.set(9,2);
    this.treadBump=grainTexture('tread');this.treadBump.repeat.set(1,1);
    this.metalBump=grainTexture('metal');this.metalBump.repeat.set(1,2);
    this.rubberMaterial=new THREE.MeshStandardMaterial({color:0x202329,roughness:.78,metalness:.02,bumpMap:this.rubberBump,bumpScale:.018,envMapIntensity:.65});
    this.treadMaterial=this.rubberMaterial.clone();this.treadMaterial.bumpMap=this.treadBump;this.treadMaterial.bumpScale=.012;
    this.rimMaterial=new THREE.MeshStandardMaterial({color:0x9ba5b4,metalness:.94,roughness:.23,bumpMap:this.metalBump,bumpScale:.004,envMapIntensity:1.7});
    this.rimEdgeMaterial=new THREE.MeshStandardMaterial({color:0xdfce9e,metalness:.96,roughness:.19,envMapIntensity:1.8});
    this.rimBarrelMaterial=new THREE.MeshStandardMaterial({color:0x635236,metalness:.9,roughness:.38,envMapIntensity:.8,side:THREE.DoubleSide});
    this.darkMetal=new THREE.MeshStandardMaterial({color:0x262c35,metalness:.8,roughness:.42});
    this.discMaterial=new THREE.MeshStandardMaterial({color:0x35404e,metalness:.7,roughness:.58,envMapIntensity:.5});
    const profile=[ [1.08,-.405],[1.18,-.465],[1.32,-.46],[1.40,-.43],...[...Array(17)].map((_,i)=>{const z=-.43+i/16*.86;return [crownRadius(z)-.001,z];}),[1.40,.43],[1.32,.46],[1.18,.465],[1.08,.405] ].map(p=>new THREE.Vector2(...p));
    const tire=new THREE.Mesh(new THREE.LatheGeometry(profile,144),this.rubberMaterial);tire.rotation.x=Math.PI/2;tire.castShadow=true;this.wheelSpin.add(tire);
    const supportGeometry=tire.geometry.clone().rotateX(Math.PI/2);this.casingSupport=new Float32Array(supportGeometry.attributes.position.array);supportGeometry.dispose();
    const tireRing=(r,t,z,mat)=>{const m=new THREE.Mesh(new THREE.TorusGeometry(r,t,12,128),mat);m.position.z=z;this.wheelSpin.add(m);return m;};
    for(const side of [-1,1]){
      tireRing(1.33,.003,side*.457,this.rubberMaterial);tireRing(1.36,.002,side*.446,this.rubberMaterial);
    }
    this.makeTreads();
    const rimStart=this.wheelSpin.children.length;
    const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.955,.955,.75,128,1,true),this.rimBarrelMaterial);barrel.rotation.x=Math.PI/2;this.wheelSpin.add(barrel);
    const innerRecess=new THREE.Mesh(new THREE.CircleGeometry(.95,96),this.darkMetal);innerRecess.position.z=-.39;this.wheelSpin.add(innerRecess);
    this.makeBrakes();
    for(const side of [-1,1]){tireRing(.958,.032,side*.405,this.rimMaterial);tireRing(.918,.012,side*.431,this.rimEdgeMaterial);tireRing(.987,.012,side*.418,this.rimEdgeMaterial);tireRing(.94,.008,side*.385,this.rimMaterial);}
    this.spokeGroup=new THREE.Group();this.spokeGroup.name='wheel-spokes';this.wheelSpin.add(this.spokeGroup);this.makeSpokes();
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(.24,.265,.095,64),this.rimMaterial);hub.rotation.x=Math.PI/2;hub.position.z=.414;hub.castShadow=true;this.wheelSpin.add(hub);
    const hubCap=new THREE.Mesh(new THREE.CylinderGeometry(.126,.126,.027,64),this.darkMetal);hubCap.rotation.x=Math.PI/2;hubCap.position.z=.477;this.wheelSpin.add(hubCap);
    const badge=new THREE.Mesh(new THREE.TorusGeometry(.11,.006,8,64),this.rimEdgeMaterial);badge.position.z=.496;this.wheelSpin.add(badge);
    for(let i=0;i<5;i++){const a=i/5*TAU+.25;
      const socket=new THREE.Mesh(new THREE.CylinderGeometry(.042,.042,.012,24),this.darkMetal);socket.rotation.x=Math.PI/2;socket.position.set(Math.cos(a)*.188,Math.sin(a)*.188,.466);this.wheelSpin.add(socket);
      const bolt=new THREE.Mesh(new THREE.CylinderGeometry(.024,.024,.027,6),this.rimEdgeMaterial);bolt.rotation.x=Math.PI/2;bolt.position.set(Math.cos(a)*.188,Math.sin(a)*.188,.481);this.wheelSpin.add(bolt);
      const emblem=new THREE.Mesh(new THREE.BoxGeometry(.012,.071,.008),this.rimEdgeMaterial);emblem.position.set(Math.cos(a)*.035,Math.sin(a)*.035,.502);emblem.rotation.z=a-Math.PI/2;this.wheelSpin.add(emblem);
    }
    const valve=new THREE.Mesh(new THREE.CylinderGeometry(.016,.021,.085,12),this.darkMetal);valve.position.set(.6,-.65,.432);valve.rotation.z=-.75;this.wheelSpin.add(valve);
    this.rimAssembly=new THREE.Group();this.rimAssembly.name='wheel-rim';for(const mesh of this.wheelSpin.children.slice(rimStart))this.rimAssembly.add(mesh);this.rimAssembly.scale.set(1.12,1.12,1);this.wheelSpin.add(this.rimAssembly);this.caliper.scale.set(1.12,1.12,1);this.caliper.position.x*=1.12;this.caliper.position.y*=1.12;
    this.makeSidewallText();this.maskWheelClouds();
  }
  makeBrakes(){
    const rotorShape=new THREE.Shape();rotorShape.absarc(0,0,.835,0,TAU,false);
    const centerHole=new THREE.Path();centerHole.absarc(0,0,.29,0,TAU,true);rotorShape.holes.push(centerHole);
    for(let ring=0;ring<3;ring++)for(let i=0;i<22;i++){const a=(i+(ring%2)*.5)/22*TAU,r=.51+ring*.115;const hole=new THREE.Path();hole.absarc(Math.cos(a)*r,Math.sin(a)*r,.017,0,TAU,true);rotorShape.holes.push(hole);}
    const rotor=new THREE.Mesh(new THREE.ExtrudeGeometry(rotorShape,{depth:.038,bevelEnabled:false,curveSegments:24}),new THREE.MeshStandardMaterial({color:0x777e89,metalness:.83,roughness:.5,envMapIntensity:.65}));rotor.position.z=.12;rotor.castShadow=true;this.wheelSpin.add(rotor);
    for(const radius of [.39,.48,.60,.71,.815]){const ring=new THREE.Mesh(new THREE.TorusGeometry(radius,.0009,4,128),this.discMaterial);ring.position.z=.162;this.wheelSpin.add(ring);}
    const hat=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,.045,48),this.darkMetal);hat.rotation.x=Math.PI/2;hat.position.z=.1;this.wheelSpin.add(hat);
    this.caliperMaterial=new THREE.MeshStandardMaterial({color:0xc3112c,metalness:.28,roughness:.27,envMapIntensity:1});
    this.caliper=new THREE.Group();this.caliper.position.set(.65,.035,.19);this.wheelRoot.add(this.caliper);
    const body=new THREE.Mesh(new RoundedBoxGeometry(.255,.78,.205,4,.05),this.caliperMaterial);body.castShadow=true;this.caliper.add(body);
    for(const y of [-.25,.25]){const end=new THREE.Mesh(new RoundedBoxGeometry(.30,.16,.19,3,.035),this.caliperMaterial);end.position.set(-.025,y,-.02);this.caliper.add(end);}
    for(const y of [-.3,.3]){const bolt=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.014,6),this.rimEdgeMaterial);bolt.rotation.x=Math.PI/2;bolt.position.set(.02,y,.111);this.caliper.add(bolt);}
    const text=canvasTexture(256,(ctx,s)=>{ctx.clearRect(0,0,s,s);ctx.fillStyle='#f2ecdf';ctx.font='bold 54px Arial';ctx.textAlign='center';ctx.translate(s/2,s/2);ctx.rotate(-Math.PI/2);ctx.fillText('GRIP',0,18);},true);
    const label=new THREE.Mesh(new THREE.PlaneGeometry(.15,.38),new THREE.MeshBasicMaterial({map:text,transparent:true,depthWrite:false}));label.position.z=.105;this.caliper.add(label);
  }
  maskWheelClouds(){
    this.wheelRoot.traverse(mesh=>{
      if(!mesh.isMesh)return;
      for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
        // Transparent label planes must not mask their invisible rectangular area.
        if(material.transparent)continue;
        material.stencilWrite=true;material.stencilRef=1;material.stencilFunc=THREE.AlwaysStencilFunc;
        material.stencilFail=THREE.KeepStencilOp;material.stencilZFail=THREE.KeepStencilOp;material.stencilZPass=THREE.ReplaceStencilOp;
      }
    });
  }
  makeTreads(){
    this.treadUniforms={uTreadSnow:{value:this.settings.treadSnow}};
    this.treadMaterial.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,this.treadUniforms);
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vCrownUV;').replace('#include <begin_vertex>','#include <begin_vertex>\nvCrownUV=uv;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec2 vCrownUV;uniform float uTreadSnow;${noiseGLSL}`)
        .replace('#include <color_fragment>',`#include <color_fragment>\nfloat z=(vCrownUV.y-.5)*.86;float phase=fract(vCrownUV.x*56.+abs(z)*3.5);float sipe=1.-smoothstep(.018,.070,abs(fract(phase*3.+sin(z*90.)*.06)-.5));diffuseColor.rgb*=1.-sipe*.38;float frost=(1.-smoothstep(.02,.09,min(phase,1.-phase)))*noise2(vCrownUV*vec2(500.,70.))*uTreadSnow;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.7,.75,.82),frost);`)
        .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>\nfloat cut=-sipe*.007;normal=perturbNormalArb(-vViewPosition,normal,vec2(dFdx(cut),dFdy(cut)),faceDirection);`);
    };
    this.treadMaterial.customProgramCacheKey=()=> 'continuous-winter-crown';
    this.treads=new THREE.Mesh(createWinterTread(this.settings.treadDepth),this.treadMaterial);this.treads.castShadow=true;this.wheelSpin.add(this.treads);this.currentTreadDepth=this.settings.treadDepth;
  }
  updateTreads(){this.treadUniforms.uTreadSnow.value=this.settings.treadSnow;if(this.currentTreadDepth!==this.settings.treadDepth){const old=this.treads.geometry;this.treads.geometry=createWinterTread(this.settings.treadDepth);old.dispose();this.currentTreadDepth=this.settings.treadDepth;}}
  makeSpokes(){
    const geometries=new Set();this.spokeGroup.traverse(mesh=>{if(mesh.geometry)geometries.add(mesh.geometry);});this.spokeGroup.clear();for(const g of geometries)g.dispose();
    const forged=makeForgedSpokes(Number(this.settings.spokeStyle),this.rimMaterial,this.rimEdgeMaterial);this.spokeGroup.add(...forged.children);
  }
  makeSidewallText(){
    const texture=canvasTexture(1024,(ctx,s)=>{ctx.clearRect(0,0,s,s);ctx.translate(s/2,s/2);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#5d626a';ctx.font='500 25px Arial';const text='WINTER  /  SNOW GRIP';const chars=[...text];chars.forEach((char,i)=>{const a=-Math.PI*.78+i/(chars.length-1)*Math.PI*.55;ctx.save();ctx.rotate(a);ctx.translate(0,-436);ctx.fillText(char,0,0);ctx.restore();});ctx.font='20px Arial';ctx.save();ctx.rotate(Math.PI);ctx.fillText('225 / 45 R20  ·  3PMSF',0,-436);ctx.restore();},true);
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2.95,2.95),new THREE.MeshStandardMaterial({map:texture,transparent:true,roughness:.85,metalness:0,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}));mesh.position.z=.469;this.wheelSpin.add(mesh);
  }
  makeSnow(){
    this.snowCount=120000;const positions=new Float32Array(this.snowCount*3),randoms=new Float32Array(this.snowCount);for(let i=0;i<this.snowCount;i++){positions[i*3]=(Math.random()-.5)*42;positions[i*3+1]=Math.random()*30;positions[i*3+2]=(Math.random()-.5)*42;randoms[i]=Math.random();}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(positions,3));geo.setAttribute('aRandom',new THREE.BufferAttribute(randoms,1));
    this.snowUniforms={uTime:{value:0},uSize:{value:this.settings.flakeSize},uFallSpeed:{value:this.settings.fallSpeed},uWind:{value:new THREE.Vector2(1,0)},uSpeed:{value:1},uPixelRatio:{value:this.renderer.getPixelRatio()}};
    const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:this.snowUniforms,vertexShader:`attribute float aRandom;uniform float uTime;uniform float uSize;uniform float uFallSpeed;uniform vec2 uWind;uniform float uSpeed;uniform float uPixelRatio;varying float vAlpha;void main(){vec3 p=position;p.y=mod(p.y-uTime*uFallSpeed*(.6+aRandom*.8),30.)-12.;p.x=mod(p.x+uWind.x*uTime*uSpeed+sin(p.y*.5+aRandom*30.)*.25+21.,42.)-21.;p.z=mod(p.z+uWind.y*uTime*uSpeed+21.,42.)-21.;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(uSize*(.45+aRandom)*650.*uPixelRatio/max(.1,-mv.z),1.,40.);vAlpha=(.4+aRandom*.6)*(1.-smoothstep(12.,55.,-mv.z));}`,fragmentShader:`varying float vAlpha;void main(){float d=length(gl_PointCoord-.5)*2.;float alpha=pow(max(0.,1.-d),1.5)*vAlpha;if(alpha<.01)discard;gl_FragColor=vec4(.95,.97,1.,alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`});
    this.snow=new THREE.Points(geo,mat);this.snow.frustumCulled=false;this.snow.renderOrder=20;this.scene.add(this.snow);
  }
  makeSpray(){this.contactSnow=new ContactSnow(this.renderer.getPixelRatio());this.contactSnow.mesh.renderOrder=20;this.scene.add(this.contactSnow.mesh);}
  makeContactShadow(){
    const texture=canvasTexture(128,(ctx,s)=>{const g=ctx.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);g.addColorStop(0,'rgba(1,8,14,.8)');g.addColorStop(.4,'rgba(1,8,14,.3)');g.addColorStop(1,'rgba(1,8,14,0)');ctx.fillStyle=g;ctx.fillRect(0,0,s,s);},true);
    this.contact=new THREE.Mesh(new THREE.PlaneGeometry(1.3,.65),new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:.45,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));this.scene.add(this.contact);
    this.leftContactShadow=new THREE.Mesh(new THREE.PlaneGeometry(.28,.20),this.contact.material.clone());this.scene.add(this.leftContactShadow);this.refreshContactShadow();
  }
  refreshContactShadow(){if(!this.contact||!this.cliffs)return;this.contact.position.copy(this.contactPosition).addScaledVector(this.contactNormal,.014);this.contact.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),this.contactNormal);
    const seat=this.cliffs.queryLeftSeat();this.leftContactShadow.position.copy(seat.point).addScaledVector(seat.normal,.007);this.leftContactShadow.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),seat.normal);
    const local=seat.point.clone().sub(this.wheelRoot.position).applyQuaternion(this.wheelRoot.quaternion.clone().invert()).divideScalar(this.settings.wheelScale);const z=THREE.MathUtils.clamp(local.z,-.43,.43);
    const gap=Math.abs(Math.hypot(local.x,local.y)-(crownRadius(z)+this.settings.treadDepth))+Math.max(0,Math.abs(local.z)-.46);
    this.leftContactShadow.material.opacity=this.settings.shadowOpacity*.8*Math.max(0,1-gap/.22);
  }
  positionWheel(){
    const s=this.settings;this.wheelRoot.rotation.set(rad(s.wheelPitch),rad(s.wheelYaw),rad(s.wheelTilt));this.wheelRoot.scale.setScalar(s.wheelScale);
    const key=[s.wheelX,s.wheelZ,s.hillHeight,s.snowDepth,this.cliffs.accumulationRevision??0].join(',');
    if(this.contactQueryKey!==key){this.rockContact=this.cliffs.queryContact(s.wheelX,s.wheelZ);this.contactQueryKey=key;}
    this.contactPosition.copy(this.rockContact.point);
    const axis=new THREE.Vector3(0,0,1).applyQuaternion(this.wheelRoot.quaternion);
    this.contactNormal.copy(this.rockContact.normal);
    const spin=this.wheelSpin.rotation.z;
    const normalLocal=this.contactNormal.clone().applyQuaternion(this.wheelRoot.quaternion.clone().invert()).applyAxisAngle(new THREE.Vector3(0,0,1),-spin);
    const support=new THREE.Vector3();
    let minimum=findTreadSupport(this.treads.geometry,this.currentTreadDepth,normalLocal,support);
    const positions=this.casingSupport;
    for(let i=0;i<positions.length;i+=3){const dot=positions[i]*normalLocal.x+positions[i+1]*normalLocal.y+positions[i+2]*normalLocal.z;if(dot<minimum){minimum=dot;support.set(positions[i],positions[i+1],positions[i+2]);}}
    support.applyAxisAngle(new THREE.Vector3(0,0,1),spin).applyQuaternion(this.wheelRoot.quaternion).multiplyScalar(s.wheelScale);
    this.wheelRoot.position.copy(this.contactPosition).sub(support);
    this.contactTangent.crossVectors(axis,support.clone().normalize()).negate().addScaledVector(this.contactNormal,.15).normalize();
    this.refreshContactShadow();
  }

  update(key){
    const s=this.settings;
    if(!key||key==='spinTextMotion')this.spinViewport.style.setProperty('--spin-text-motion',s.spinTextMotion);
    if(!key||key==='spinTextBlur')this.spinViewport.style.setProperty('--spin-text-blur',s.spinTextBlur);
    if(!key||key==='spinTextWave')this.spinTextWave?.setAttribute('baseFrequency',`${.004*s.spinTextWave} ${.018*s.spinTextWave}`);
    this.cliffs.update(s);
    this.renderer.toneMappingExposure=s.exposure;this.sun.intensity=s.sunIntensity;this.sun.color.set(s.sunColor);const az=rad(s.sunAzimuth),el=rad(s.sunElevation);this.sun.position.set(Math.sin(az)*Math.cos(el)*35,Math.sin(el)*35,Math.cos(az)*Math.cos(el)*35);this.sun.shadow.radius=s.shadowSoftness;
    this.ambient.intensity=s.ambientIntensity;this.ambient.color.set(s.ambientColor);this.fill.intensity=s.fillIntensity;this.fill.color.set(s.ambientColor);this.rimLight.intensity=s.rimIntensity;
    this.skyUniforms.top.value.set(s.skyColor);this.skyUniforms.bottom.value.set(s.horizonColor);this.skyUniforms.brightness.value=s.backgroundLight;this.scene.fog.color.set(s.horizonColor);this.scene.fog.density=s.fog;
    this.groundMaterial.color.set(s.snowColor);this.groundMaterial.roughness=s.snowRoughness;this.groundMaterial.bumpScale=s.snowGrain;this.uniforms.uGrain.value=s.snowGrain;this.uniforms.uGrainScale.value=s.snowScale;
    this.uniforms.uTerrainLight.value=.75*(.55+s.sunIntensity*.08+s.ambientIntensity*.12+s.fillIntensity*.03+s.rimIntensity*.015);
    if(this.mountainMaterial){this.mountainMaterial.color.set(s.snowColor);this.mountainMaterial.roughness=s.snowRoughness;this.mountainMaterial.bumpScale=s.snowGrain;}
    const direction=new THREE.Vector2(Math.cos(rad(s.windDirection)),Math.sin(rad(s.windDirection)));this.uniforms.uWind.value.copy(direction);this.uniforms.uWindSpeed.value=s.windSpeed;this.uniforms.uVeil.value=s.windVeil;this.uniforms.uVeilScale.value=s.veilScale;this.uniforms.uSparkle.value=s.snowSparkle;
    this.snowUniforms.uWind.value.copy(direction);this.snowUniforms.uSpeed.value=s.windSpeed;this.snowUniforms.uSize.value=s.flakeSize;this.snowUniforms.uFallSpeed.value=s.fallSpeed;
    this.updateSnowfall();
    this.rubberMaterial.color.set(s.rubberColor);this.rubberMaterial.roughness=s.rubberRoughness;this.rubberMaterial.metalness=s.rubberMetalness;this.rubberMaterial.bumpScale=s.rubberBump;
    this.treadMaterial.color.set(s.rubberColor);this.treadMaterial.roughness=s.rubberRoughness;this.treadMaterial.metalness=s.rubberMetalness;this.treadMaterial.bumpScale=s.rubberBump*.7;
    this.rimMaterial.color.set(s.rimColor);this.rimMaterial.roughness=s.rimRoughness;this.rimMaterial.metalness=s.rimMetalness;this.rimMaterial.bumpScale=s.rimBump;
    this.rimEdgeMaterial.color.copy(this.rimMaterial.color).lerp(new THREE.Color(0xfff4d7),.32);this.rimEdgeMaterial.roughness=Math.max(.08,s.rimRoughness*.65);this.rimBarrelMaterial.color.copy(this.rimMaterial.color).multiplyScalar(.46);
    if(!key||['treadDepth','treadSnow'].includes(key))this.updateTreads();
    this.positionWheel();
    if(!key||['hillHeight','snowRelief'].includes(key))this.refreshTerrain();
    if(!key||key==='spokeStyle')this.makeSpokes();
    this.refreshContactShadow();
    this.skyUniforms.cloudDensity.value=s.cloudDensity;this.skyUniforms.cloudContrast.value=s.cloudContrast;this.skyUniforms.cloudSpeed.value=s.cloudSpeed;this.skyUniforms.windVeil.value=s.windVeil;this.skyUniforms.windSpeed.value=s.windSpeed;this.skyUniforms.veilScale.value=s.veilScale;
    this.cloudLayers.update(s);
    this.lens.update(s,THREE.MathUtils.smoothstep(this.launchProgress,.28,.94));
    this.updateTextureTransforms();
  }
  updateTextureTransforms(){
    const s=this.settings;
    for(const target of ['snow','rubber','rim']){
      const mat=target==='snow'?this.groundMaterial:target==='rubber'?this.rubberMaterial:this.rimMaterial;
      const scale=target==='snow'?s.snowScale:s[`${target}TextureScale`];const rotation=rad(s[`${target}TextureRotation`]);
      for(const slot of ['map','bumpMap','roughnessMap']){const t=mat[slot];if(t){if(target==='snow'&&slot==='map'&&this.referenceSnow&&!this.customTextures.snow.map){t.repeat.set(1,1);t.rotation=0;continue;}t.repeat.set(scale,scale);if(target==='rubber'&&!this.customTextures.rubber[slot])t.repeat.set(scale*9,scale*2);t.rotation=rotation;t.center.set(.5,.5);}}
      const mix=s[`${target==='snow'?'snow':target}TextureMix`];
      // Uploaded color texture strength is blended in linear color space in the material shader.
      if(this.customTextures[target].map)this.customTextures[target].map.userData.mix=mix;
      if(target==='rubber')for(const slot of ['map','roughnessMap'])this.treadMaterial[slot]=mat[slot];
    }
  }
  async loadTextureFile(file){
    const url=URL.createObjectURL(file);
    try{return await this.loadTexture(url);}finally{URL.revokeObjectURL(url);}
  }
  loadTexture(url){return new THREE.TextureLoader().loadAsync(url);}
  applyTexture(target,slot,texture,name){
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=8;if(slot==='map')texture.colorSpace=THREE.SRGBColorSpace;
    const old=this.customTextures[target][slot];if(old)old.dispose();this.customTextures[target][slot]=texture;this.textureNames[target][slot]=name;
    const material=target==='snow'?this.groundMaterial:target==='rubber'?this.rubberMaterial:this.rimMaterial;material[slot]=texture;
    if(target==='snow')this.cliffs.setSnowTexture(slot,texture);
    this.installTextureMix(material,target);material.needsUpdate=true;this.updateTextureTransforms();
    if(target==='rubber'){for(const type of ['map','bumpMap','roughnessMap'])if(this.customTextures.rubber[type])this.treadMaterial[type]=this.customTextures.rubber[type];this.installTextureMix(this.treadMaterial,target);this.treadMaterial.needsUpdate=true;}
  }
  installTextureMix(material,target){
    if(material.userData.textureMixInstalled)return;
    const original=material.onBeforeCompile.bind(material);
    material.onBeforeCompile=(shader,...args)=>{original(shader,...args);const uniform={get value(){return material.userData.mixValue??1;}};shader.uniforms.uMapMix=uniform;shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float uMapMix;').replace('#include <map_fragment>',`#ifdef USE_MAP\nvec4 sampledDiffuseColor=texture2D(map,vMapUv);\ndiffuseColor*=mix(vec4(1.),sampledDiffuseColor,uMapMix);\n#endif`);};material.userData.textureMixInstalled=true;material.customProgramCacheKey=()=>`${material===this.treadMaterial?'winter-crown':'surface'}-custom-${target}`;
  }
  clearTextures(target){
    const material=target==='snow'?this.groundMaterial:target==='rubber'?this.rubberMaterial:this.rimMaterial;
    Object.values(this.customTextures[target]).forEach(t=>t.dispose());this.customTextures[target]={};this.textureNames[target]={};material.map=target==='snow'&&this.referenceSnow?this.referenceSnow.groundColor:null;material.roughnessMap=null;material.bumpMap=target==='snow'?this.snowBump:target==='rubber'?this.rubberBump:this.metalBump;material.needsUpdate=true;
    if(target==='snow')for(const slot of ['map','bumpMap','roughnessMap'])this.cliffs.setSnowTexture(slot,null);
    if(target==='rubber'){this.treadMaterial.map=null;this.treadMaterial.roughnessMap=null;this.treadMaterial.bumpMap=this.treadBump;this.treadMaterial.needsUpdate=true;}this.update();
  }
  reset(){this.depth=0;this.jumpTime=-1;this.cycle=0;this.drive.reset();this.motorRPM=0;this.wheelSpin.rotation.z=0;this.contactSnow.clear();this.lastState='';this.contactQueryKey=null;for(const t of ['snow','rubber','rim'])this.clearTextures(t);this.resetCamera();this.update();this.settledSnow?.reset();this.wheelSnow?.reset();this.positionWheel();}
  stopWheel(){this.drive.stop();this.motorRPM=0;this.lastState='';this.launchGesture=null;}
  clearAccumulatedSnow(){this.wheelSnow.reset({empty:true});this.settledSnow.reset({empty:true});this.contactQueryKey=null;this.positionWheel();}
  jump(){this.burst();}
  burst(){this.contactSnow.burst(520);}

  bindScenePointer(canvas) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const hitArea = new THREE.Sphere();
    let drag = null;

    this.finishScenePointer = () => {
      if (!drag) return;
      const { id, mode } = drag;
      drag = null;
      if (mode === 'inspect') this.catalog.endDrag();
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    };

    canvas.addEventListener('pointerdown', event => {
      if (drag || !event.isPrimary || event.button !== 0) return;
      const touch = event.pointerType === 'touch';
      let mode;
      if (this.stage === 'catalog') {
        const wheel = this.catalog.wheels[this.catalog.index];
        if (!wheel?.visible) return;
        const bounds = canvas.getBoundingClientRect();
        pointer.set(
          2 * (event.clientX - bounds.left) / bounds.width - 1,
          1 - 2 * (event.clientY - bounds.top) / bounds.height,
        );
        raycaster.setFromCamera(pointer, this.camera);
        wheel.getWorldPosition(hitArea.center);
        hitArea.radius = 1.5 * wheel.scale.x;
        if (raycaster.ray.intersectsSphere(hitArea)) {
          if (!this.catalog.beginDrag()) return;
          mode = 'inspect';
        } else if (touch) {
          mode = 'browse';
        }
      } else if (touch && this.stage === 'storm' && !this.paused && !this.panelVisible) {
        mode = 'spin';
        this.cursor.set(0, 0);
        this.drive.configure(this.settings);
      }
      if (!mode) return;
      drag = { id: event.pointerId, mode, x: event.clientX, y: event.clientY, startY: event.clientY, axis: null };
      canvas.setPointerCapture(drag.id);
      event.preventDefault();
    });

    canvas.addEventListener('pointermove', event => {
      if (drag?.id !== event.pointerId) return;
      if (drag.mode === 'browse') return;
      if (drag.mode === 'inspect') {
        this.catalog.dragBy(event.clientX - drag.x, event.clientY - drag.y);
      } else {
        if (!drag.axis) {
          const x = Math.abs(event.clientX - drag.x);
          const y = Math.abs(event.clientY - drag.startY);
          if (Math.max(x, y) < 8) return;
          drag.axis = y >= x ? 'y' : 'x';
        }
        if (drag.axis === 'y') {
          const pixels = scrollPixels((drag.y - event.clientY) * 6);
          if (Math.abs(pixels) < 3) return;
          const speed = this.drive.impulse(pixels);
          this.advanceLaunchGesture(speed, pixels, event.timeStamp, true);
          if (!drag) return;
        }
      }
      drag.x = event.clientX;
      drag.y = event.clientY;
    });

    const finish = event => {
      if (drag?.id !== event.pointerId) return;
      if (drag.mode === 'browse' && event.type === 'pointerup') {
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (Math.abs(dx) >= 42 && Math.abs(dx) > Math.abs(dy) * 1.25) this.catalog.move(-Math.sign(dx));
      }
      this.finishScenePointer();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, finish);
    }
    window.addEventListener('blur', this.finishScenePointer);
  }

  setStage(stage){
    this.finishScenePointer?.();
    this.stage=stage;
    this.spinViewport.dataset.stage=stage;
  }

  advanceLaunchGesture(speed,pixels,now,touch=false){
    const direction=Math.sign(pixels);
    const gesture=this.launchGesture;
    if(!gesture||gesture.direction!==direction||gesture.touch!==touch||now-gesture.lastInput>1500){
      this.launchGesture=Math.abs(speed)>=160?{direction,touch,start:now,lastInput:now,distance:0}:null;
      return;
    }
    gesture.lastInput=now;
    gesture.distance+=Math.abs(pixels);
    if(gesture.distance>=(touch?580:1350)&&now-gesture.start>=(touch?90:420)&&Math.abs(speed)>=160)this.launchWheel(speed);
  }

  launchWheel(speed){
    this.launchGesture=null;
    this.launchPosition.copy(this.wheelRoot.position);
    this.launchRotation.copy(this.wheelRoot.quaternion);
    this.catalogEntryPosition.copy(catalogCenter);
    this.catalogEntryRotation.copy(catalogRotation);
    this.catalogEntryScale=this.settings.wheelScale;
    this.launchRadius=this.cameraSpherical.radius;
    this.launchSpeed=speed;
    this.catalog.prepareEntrance();
    this.drive.stop();
    this.contactSnow.burst(900);
    this.onState('Відрив від скель',speed);
    this.setStage('launching');
  }

  returnFromCatalog(){
    if(this.stage!=='catalog')return;
    this.finishScenePointer();
    this.catalogEntryPosition.copy(this.wheelRoot.position);
    this.catalogEntryRotation.copy(this.wheelRoot.quaternion);
    this.catalogEntryScale=this.wheelRoot.scale.x;
    this.catalog.leave();
    this.setStage('returning');
  }

  drawCatalogPreview(canvas, index) {
    const productWheel = this.catalog.wheels[index];
    const context = canvas.getContext('2d');
    if (!productWheel || !context) return;

    const preview = new THREE.Scene();
    preview.background = new THREE.Color('#112638');
    preview.environment = this.environment;
    const wheel = productWheel.clone();
    wheel.position.set(0, 0, 0);
    wheel.scale.setScalar(1);
    wheel.quaternion.copy(catalogRotation);
    preview.add(wheel, new THREE.HemisphereLight(0xe3f1ff, 0x526074, 1.4));
    const key = new THREE.DirectionalLight(0xf7fbff, 2.8);
    key.position.set(-3, 5, 4);
    preview.add(key);

    const source = this.renderer.domElement;
    const { width, height } = source;
    const crop = Math.min(width, height);
    const camera = new THREE.PerspectiveCamera(35, width / height, .1, 30);
    camera.position.z = 6.25 * height / crop;
    try {
      this.renderer.render(preview, camera);
      context.drawImage(source, (width - crop) / 2, (height - crop) / 2, crop, crop, 0, 0, canvas.width, canvas.height);
    } finally {
      this.lens.render(this.scene, this.camera);
    }
  }

  updateSnowfall() {
    const density = THREE.MathUtils.clamp(this.settings.snowfall / 12, 0, 1);
    const catalogBlend = THREE.MathUtils.smoothstep(this.launchProgress, .28, .94);
    const coverage = THREE.MathUtils.lerp(1, .48, catalogBlend);
    this.snow.geometry.setDrawRange(0, Math.floor(this.snowCount * density * coverage));
  }

  updateLaunch(dt){
    const reduced=this.reducedMotion.matches;
    if(this.stage==='launching')this.launchProgress=Math.min(1,this.launchProgress+dt/(reduced?.18:2.1));
    if(this.stage==='returning')this.launchProgress=Math.max(0,this.launchProgress-dt/(reduced?.18:1.25));
    const p=this.launchProgress;
    const pose=THREE.MathUtils.smoothstep(p,0,1);
    const atmosphere=THREE.MathUtils.smoothstep(p,.28,.94);
    this.cliffs.setSeparation(.76*THREE.MathUtils.smoothstep(p,.02,.76));
    this.cliffs.group.position.z=-4.8*atmosphere;
    this.cliffs.group.position.y=-.65*atmosphere;
    this.wheelRoot.position.lerpVectors(this.launchPosition,this.catalogEntryPosition,pose);
    this.wheelRoot.position.y+=(reduced?0:.42)*Math.sin(Math.PI*pose);
    this.wheelRoot.scale.setScalar(THREE.MathUtils.lerp(this.settings.wheelScale,this.catalogEntryScale,pose));
    this.wheelRoot.quaternion.slerpQuaternions(this.launchRotation,this.catalogEntryRotation,pose);
    this.motorRPM=this.stage==='returning'?0:this.launchSpeed*(1-THREE.MathUtils.smoothstep(p,0,.84));
    this.wheelSpin.rotation.z-=this.motorRPM/60*TAU*dt;
    this.skyUniforms.uAnalysis.value=atmosphere;
    this.cloudLayers.setCatalogBlend(atmosphere);
    this.lens.update(this.settings,atmosphere);
    this.updateSnowfall();
    this.settledSnow.group.visible=p<.14;
    this.contact.visible=this.leftContactShadow.visible=p===0;
    if(p<.62&&this.stage==='launching'){
      this.contactSnow.update(dt,{contact:this.contactPosition,normal:this.contactNormal,tangent:this.contactTangent,rpm:0,settings:this.settings,time:this.time});
    }else if(this.contactSnow.mesh.visible)this.contactSnow.clear();

    if(p===1&&this.stage==='launching'){
      this.catalog.enter();
      this.lastCatalogWheel=performance.now();
      this.setStage('catalog');
    }
    if(p===0&&this.stage==='returning'){
      this.motorRPM=0;
      this.contactQueryKey=null;
      this.positionWheel();
      this.setStage('storm');
      this.onState('Прокрути, щоб обертати',0);
    }
  }

  updateSpinCamera(elapsed){
    const s=this.settings;
    const target=!s.spinEnabled||this.reducedMotion.matches||this.stage!=='storm'?0:1-Math.exp(-Math.abs(this.motorRPM)/s.spinRPMResponse);
    const response=target>this.spinEffect?s.spinAttack:s.spinRelease;
    this.spinEffect+=(target-this.spinEffect)*(1-Math.exp(-elapsed/response));
    if(target===0&&this.spinEffect<.001)this.spinEffect=0;
    const displayStrength=this.spinEffect.toFixed(3);
    if(displayStrength!==this.previousSpinDisplay){
      this.spinViewport.style.setProperty('--spin-effect',displayStrength);
      this.spinViewport.classList.toggle('spin-active',Number(displayStrength)>0);
      this.previousSpinDisplay=displayStrength;
    }

    const displacement=(this.panelVisible?0:this.spinEffect*s.spinTextWarp).toFixed(2);
    if(displacement!==this.previousTextDisplacement){
      this.spinTextDisplacement?.setAttribute('scale',displacement);
      this.spinViewport.classList.toggle('spin-text-warp',Number(displacement)>0);
      this.previousTextDisplacement=displacement;
    }
    this.cameraSpherical.radius=this.cameraDistance*(1-s.spinZoom/100*this.spinEffect);
    const transitionRadius=this.stage==='launching'?this.launchRadius:this.cameraSpherical.radius;
    this.cameraSpherical.radius=THREE.MathUtils.lerp(transitionRadius,7.9,THREE.MathUtils.smoothstep(this.launchProgress,0,1));
    this.camera.position.setFromSpherical(this.cameraSpherical).add(this.controls.target);
    this.camera.lookAt(this.controls.target);
    const scanStrength=this.stage==='storm'&&!this.panelVisible&&!this.reducedMotion.matches
      ? THREE.MathUtils.smoothstep(Math.abs(this.motorRPM),5,70):0;
    if(this.spinEffect>0||scanStrength>0){
      this.camera.updateMatrixWorld();
      this.spinFocus.copy(this.wheelRoot.position).project(this.camera);
    }
    const scanOpacity=scanStrength.toFixed(2);
    if(scanOpacity!==this.previousScanOpacity){
      this.spinViewport.style.setProperty('--scan-strength',scanOpacity);
      this.previousScanOpacity=scanOpacity;
    }
    if(scanStrength>0){
      const turnsLabel=`${this.scanTurns.toFixed(this.scanTurns<100?2:1)} REV`;
      const frequencyLabel=`${(Math.abs(this.motorRPM)/60).toFixed(2)} HZ`;
      if(this.scanTurnsLabel&&this.scanTurnsLabel.textContent!==turnsLabel)this.scanTurnsLabel.textContent=turnsLabel;
      if(this.scanFrequencyLabel&&this.scanFrequencyLabel.textContent!==frequencyLabel)this.scanFrequencyLabel.textContent=frequencyLabel;
      this.spinViewport.style.setProperty('--scan-x',`${(50+50*this.spinFocus.x).toFixed(2)}%`);
      this.spinViewport.style.setProperty('--scan-y',`${(50-50*this.spinFocus.y).toFixed(2)}%`);
      const radius=this.camera.position.distanceTo(this.wheelRoot.position);
      const wheelHeight=100*1.56*s.wheelScale/(radius*Math.tan(rad(this.camera.fov)/2));
      this.spinViewport.style.setProperty('--scan-size',`${(wheelHeight*1.16).toFixed(2)}vh`);
    }
    this.lens.setSpinEffect(this.spinEffect,.5+.5*this.spinFocus.x,.5+.5*this.spinFocus.y,rad(s.spinSceneTwist),s.spinSceneBlur);
  }

  animate(now){
    const elapsed=Math.max(0,(now-this.previousNow)/1000),dt=Math.min(elapsed,.04);this.previousNow=now;const s=this.settings;
    const cameraRadius=this.cameraDistance;
    const follow=1-Math.exp(-dt*s.parallaxSmoothing);
    this.parallax.lerp(s.parallaxEnabled&&this.stage==='storm'?this.cursor:this.neutralParallax,follow);
    this.cameraSpherical.set(cameraRadius,THREE.MathUtils.clamp(this.basePolar+this.parallax.y*rad(s.parallaxAmount)*.55,this.controls.minPolarAngle,this.controls.maxPolarAngle),this.baseAzimuth+this.parallax.x*rad(s.parallaxAmount));
    if(!this.paused&&this.stage==='storm'){
      this.time+=dt;this.uniforms.uTime.value=this.time;this.snowUniforms.uTime.value=this.time;
      const startingRPM=this.drive.rpm;
      this.motorRPM=this.drive.update(elapsed,s);
      // Integrate the coast over elapsed time so a slow frame does not stall the wheel.
      const spinStep=Math.min(elapsed,.12);
      const turns=startingRPM/60*s.scrollInertia*-Math.expm1(-spinStep/s.scrollInertia);
      if(turns!==0){
        this.scanTurns+=Math.abs(turns);
        this.wheelSpin.rotation.z-=turns*TAU;
        this.positionWheel();
      }
      if(this.motorRPM===0)this.scanTurns=0;
      this.contact.material.opacity=s.shadowOpacity;
      this.wheelSnow.update(dt,{rpm:this.motorRPM,time:this.time,settings:s});
      const accumulationRevision=this.cliffs.accumulationRevision;
      this.settledSnow.update(dt,{contact:this.contactPosition,rpm:this.motorRPM,settings:s,time:this.time});
      if(accumulationRevision!==this.cliffs.accumulationRevision)this.positionWheel();
      const state=Math.abs(this.motorRPM)<.5?'Прокрути, щоб обертати':this.motorRPM>0?'Обертання від скролу':'Зворотне обертання';
      if(this.lastState!==state||this.motorRPM===0&&this.lastReadoutRPM!==0||
        now-(this.lastReadoutTime??0)>=100&&Math.abs(this.motorRPM-(this.lastReadoutRPM??Infinity))>.5){
        this.lastState=state;this.lastReadoutRPM=this.motorRPM;this.lastReadoutTime=now;this.onState(state,this.motorRPM);
      }
      this.contactSnow.update(dt,{contact:this.contactPosition,normal:this.contactNormal,tangent:this.contactTangent.clone().multiplyScalar(this.motorRPM<0?-1:1),rpm:this.motorRPM,settings:s,time:this.time,terrain:this.cliffs,wheelRoot:this.wheelRoot});
    }else if(this.stage!=='storm'){
      this.time+=dt;
      this.uniforms.uTime.value=this.snowUniforms.uTime.value=this.time;
      if(this.stage!=='catalog')this.updateLaunch(Math.min(elapsed,.12));
    }
    this.updateSpinCamera(elapsed);
    if(this.stage==='launching'&&!this.reducedMotion.matches)this.catalog.layout(this.camera,false,this.launchProgress);
    if(this.stage==='catalog')this.catalog.update(Math.min(elapsed,.12),this.camera,this.reducedMotion.matches);
    for(const target of ['snow','rubber','rim']){const mat=target==='snow'?this.groundMaterial:target==='rubber'?this.rubberMaterial:this.rimMaterial;mat.userData.mixValue=s[`${target}TextureMix`];if(target==='rubber')this.treadMaterial.userData.mixValue=s.rubberTextureMix;}
    for(const material of this.cliffs.snowMaterials)material.userData.mixValue=s.snowTextureMix;
    this.lens.render(this.scene,this.camera);
  }
}
