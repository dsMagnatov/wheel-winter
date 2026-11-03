import * as THREE from 'three';

const clamp=THREE.MathUtils.clamp;
const value=(settings,key,fallback,min,max)=>clamp(Number.isFinite(settings?.[key])?settings[key]:fallback,min,max);
const validVector=point=>point&&Number.isFinite(point.x)&&Number.isFinite(point.y)&&Number.isFinite(point.z);
const smoothFade=(age,life)=>{const t=clamp((age-life*.65)/(life*.35),0,1);return t*t*(3-2*t);};
const PARTICLES=3500,PATCHES=360,CELL=.16,PATCH_CELL=.30;

function uploadActiveRange(attribute,count){
  if(!count)return;
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0,count*attribute.itemSize);
  attribute.needsUpdate=true;
}

function fracturedSnowGeometry(){
  // A broken, low slab with an uneven perimeter. Its size is a diameter, not
  // the radius of a faceted ball, and each moving instance changes proportions.
  const outline=[[-.49,-.18],[-.17,-.43],[.28,-.38],[.48,-.05],[.29,.37],[-.22,.42],[-.45,.12]];
  const positions=[],indices=[],n=outline.length;
  for(let layer=0;layer<2;layer++)for(let i=0;i<n;i++){
    const [x,z]=outline[i],height=layer===0?.09+Math.sin(i*2.7)*.055:-.09+Math.cos(i*1.7)*.035;
    positions.push(x,height,z);
  }
  const top=positions.length/3;positions.push(.035,.17,-.045);const bottom=positions.length/3;positions.push(0,-.12,0);
  for(let i=0;i<n;i++){const j=(i+1)%n;indices.push(top,j,i,bottom,n+i,n+j,i,j,n+i,j,n+j,n+i);}
  const indexed=new THREE.BufferGeometry();indexed.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));indexed.setIndex(indices);
  const geometry=indexed.toNonIndexed();indexed.dispose();geometry.computeVertexNormals();return geometry;
}

function softMoundGeometry(){
  const segments=36,rings=7,positions=[0,1,0],edges=[0],indices=[];
  for(let ring=1;ring<=rings;ring++)for(let j=0;j<segments;j++){
    const r=ring/rings,angle=j/segments*Math.PI*2;
    const outline=1+Math.sin(angle*3+.4)*.13+Math.cos(angle*7-1.2)*.07+Math.sin(angle*11+.6)*.045;
    const radius=r*outline;
    positions.push(Math.cos(angle)*radius,Math.pow(1-r*r,2)*(1+Math.sin(angle*5+r*4)*.06*r),Math.sin(angle)*radius);
    edges.push(r);
    if(ring===1)indices.push(0,1+(j+1)%segments,1+j);
    else{
      const a=1+(ring-2)*segments+j,b=1+(ring-2)*segments+(j+1)%segments,c=a+segments,d=b+segments;
      indices.push(a,b,c,b,d,c);
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('aPileEdge',new THREE.Float32BufferAttribute(edges,1));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

const PILE_NOISE=`
float settledHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float settledNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(settledHash(i),settledHash(i+vec2(1.,0.)),f.x),mix(settledHash(i+vec2(0.,1.)),settledHash(i+vec2(1.)),f.x),f.y);}
`;

/** Falling wheel debris and persistent, bounded snow deposits on the actual rocks. */
export class SettledSnow {
  constructor({scene,cliffs,settings={}}){
    this.cliffs=cliffs;this.settings=settings;
    this.group=new THREE.Group();this.group.name='Falling snow chunks and accumulated rock snow';scene?.add(this.group);
    this.positions=new Float32Array(PARTICLES*3);this.velocities=new Float32Array(PARTICLES*3);
    this.sizes=new Float32Array(PARTICLES);this.ages=new Float32Array(PARTICLES);this.seeds=new Float32Array(PARTICLES);
    this.alive=new Uint8Array(PARTICLES);this.kinds=new Uint8Array(PARTICLES);this.bounces=new Uint8Array(PARTICLES);
    this.collisionCeilings=new Float32Array(PARTICLES);
    this.cursor=0;this.highWater=0;
    this.surfaceCache=new Map();this.patchMap=new Map();this.pendingWeather=[];
    this.patchX=new Float32Array(PATCHES);this.patchY=new Float32Array(PATCHES);this.patchZ=new Float32Array(PATCHES);
    this.patchNormals=new Float32Array(PATCHES*3);this.patchMass=new Float32Array(PATCHES);this.patchRadius=new Float32Array(PATCHES);
    this.patchDepth=new Float32Array(PATCHES);this.patchReady=new Uint8Array(PATCHES);this.patchCount=0;this.patchCursor=0;
    this.matrix=new THREE.Matrix4();this.position=new THREE.Vector3();this.scale=new THREE.Vector3();
    this.quaternion=new THREE.Quaternion();this.normal=new THREE.Vector3();this.up=new THREE.Vector3(0,1,0);this.euler=new THREE.Euler();
    const snowMaterial=new THREE.MeshStandardMaterial({color:settings.snowColor||'#e7ebf2',roughness:.96,metalness:0,envMapIntensity:.22,transparent:true,opacity:.96,depthWrite:false});
    this.fragmentSeeds=new Float32Array(PARTICLES);
    const fragmentGeometry=fracturedSnowGeometry();fragmentGeometry.setAttribute('aFragmentSeed',new THREE.InstancedBufferAttribute(this.fragmentSeeds,1).setUsage(THREE.DynamicDrawUsage));
    snowMaterial.onBeforeCompile=shader=>{
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float aFragmentSeed;varying vec3 vFragmentGrain;')
        .replace('#include <begin_vertex>',`#include <begin_vertex>
          transformed*=vec3(.82+sin(aFragmentSeed*2.3)*.23,.65+cos(aFragmentSeed*1.7)*.26,.88+sin(aFragmentSeed*3.1)*.22);
          vFragmentGrain=position*17.+vec3(aFragmentSeed*7.);
        `);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vFragmentGrain;')
        .replace('#include <color_fragment>',`#include <color_fragment>
          float snowFacet=fract(sin(dot(floor(vFragmentGrain),vec3(17.1,31.7,49.3)))*43758.5453);
          diffuseColor.rgb*=.83+snowFacet*.17;
        `);
    };
    snowMaterial.customProgramCacheKey=()=> 'broken-granular-snow-fragments';
    this.debris=new THREE.InstancedMesh(fragmentGeometry,snowMaterial,PARTICLES);
    this.debris.name='Thin irregular snow fragments, without round balls';this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debris.count=0;this.debris.frustumCulled=false;this.debris.renderOrder=20;this.debris.castShadow=false;this.group.add(this.debris);
    const pileMaterial=snowMaterial.clone();pileMaterial.color.multiplyScalar(.56);pileMaterial.roughness=.9;pileMaterial.envMapIntensity=.1;
    pileMaterial.transparent=true;pileMaterial.depthWrite=false;pileMaterial.opacity=.78;pileMaterial.side=THREE.DoubleSide;
    pileMaterial.polygonOffset=true;pileMaterial.polygonOffsetFactor=-1;
    this.pileUniforms={uPileGrain:{value:settings.snowGrain??.012},uPileScale:{value:settings.snowScale??46}};
    pileMaterial.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,this.pileUniforms);
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float aPileEdge;varying float vSettledEdge;varying vec3 vSettledWorld;')
        .replace('#include <begin_vertex>',`#include <begin_vertex>
          vec4 settledPosition=vec4(transformed,1.);
          #ifdef USE_INSTANCING
          settledPosition=instanceMatrix*settledPosition;
          #endif
          vSettledWorld=(modelMatrix*settledPosition).xyz;vSettledEdge=aPileEdge;
        `);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying float vSettledEdge;varying vec3 vSettledWorld;uniform float uPileGrain;uniform float uPileScale;${PILE_NOISE}`)
        .replace('#include <color_fragment>',`#include <color_fragment>
          float settledBroad=settledNoise(vSettledWorld.xz*5.3+vSettledWorld.y*.31);
          float settledGrain=settledNoise(vSettledWorld.xz*uPileScale*.7+vSettledWorld.y*.6);
          diffuseColor.rgb*=.98+settledBroad*.075+settledGrain*.045;
          float settledSkirt=1.-smoothstep(.32,1.,vSettledEdge);
          float settledBreakup=smoothstep(.27,.66,settledBroad+settledSkirt*.22);
          diffuseColor.a*=settledSkirt*settledBreakup;
          if(diffuseColor.a<.008)discard;
        `)
        .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
          float settledHeight=settledNoise(vSettledWorld.xz*uPileScale*.3+vSettledWorld.y*.7)*uPileGrain*.3;
          vec3 settledQ0=dFdx(-vViewPosition),settledQ1=dFdy(-vViewPosition);
          vec3 settledR1=cross(settledQ1,normal),settledR2=cross(normal,settledQ0);
          float settledDet=dot(settledQ0,settledR1);
          vec3 settledGrad=sign(settledDet)*(dFdx(settledHeight)*settledR1+dFdy(settledHeight)*settledR2);
          normal=normalize(abs(settledDet)*normal-settledGrad);
        `);
    };
    pileMaterial.customProgramCacheKey=()=> 'irregular-feathered-settled-snow';
    this.piles=new THREE.InstancedMesh(softMoundGeometry(),pileMaterial,PATCHES);
    this.piles.name='Snow mounds retained on the rock surfaces';this.piles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.piles.count=0;this.piles.frustumCulled=false;this.piles.renderOrder=1;this.piles.receiveShadow=true;this.group.add(this.piles);
    this.powderPositions=new Float32Array(PARTICLES*3);this.powderSizes=new Float32Array(PARTICLES);this.powderAlpha=new Float32Array(PARTICLES);this.powderKinds=new Float32Array(PARTICLES);this.powderAngles=new Float32Array(PARTICLES);
    const powderGeometry=new THREE.BufferGeometry();
    powderGeometry.setAttribute('position',new THREE.BufferAttribute(this.powderPositions,3).setUsage(THREE.DynamicDrawUsage));
    powderGeometry.setAttribute('aSize',new THREE.BufferAttribute(this.powderSizes,1).setUsage(THREE.DynamicDrawUsage));
    powderGeometry.setAttribute('aAlpha',new THREE.BufferAttribute(this.powderAlpha,1).setUsage(THREE.DynamicDrawUsage));
    powderGeometry.setAttribute('aKind',new THREE.BufferAttribute(this.powderKinds,1).setUsage(THREE.DynamicDrawUsage));
    powderGeometry.setAttribute('aAngle',new THREE.BufferAttribute(this.powderAngles,1).setUsage(THREE.DynamicDrawUsage));
    const powderMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{uColor:{value:new THREE.Color(settings.snowColor||'#e7ebf2')}},
      vertexShader:`attribute float aSize;attribute float aAlpha;attribute float aKind;attribute float aAngle;varying float vAlpha;varying float vKind;varying float vAngle;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(aSize*980./max(1.,-mv.z),.75,7.);vAlpha=aAlpha;vKind=aKind;vAngle=aAngle;}`,
      fragmentShader:`uniform vec3 uColor;varying float vAlpha;varying float vKind;varying float vAngle;void main(){vec2 p=(gl_PointCoord-.5)*2.;float c=cos(vAngle),s=sin(vAngle);p=mat2(c,-s,s,c)*p;float edge=max(abs(p.x)*.85+abs(p.y)*.56,abs(p.y)*1.12);edge+=sin(p.x*12.+vAngle)*sin(p.y*8.-vAngle)*.055;float chip=1.-smoothstep(.62,.84,edge);float powder=pow(max(0.,1.-length(p)),1.4);float a=mix(chip,powder,step(.5,vKind))*vAlpha;if(a<.015)discard;gl_FragColor=vec4(uColor*(.88+.12*(1.-p.y)),a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
    this.powder=new THREE.Points(powderGeometry,powderMaterial);this.powder.name='Fine falling snow chips and restrained powder';
    this.powder.frustumCulled=false;this.powder.renderOrder=20;this.group.add(this.powder);
    this.metrics={active:0,activeChunks:0,activePowder:0,landed:0,depositedPatches:0,accumulationDepth:0,surfaceQueries:0,totalEmitted:0};
    this.reset();
  }

  /** Copies all input components now; callers may immediately reuse their vectors. */
  emit({position,velocity,size=.012,kind}={}){
    if(!validVector(position)||!validVector(velocity))return;
    const i=this.cursor,k=i*3;this.cursor=(i+1)%PARTICLES;this.highWater=Math.max(this.highWater,i+1);
    this.positions[k]=position.x;this.positions[k+1]=position.y;this.positions[k+2]=position.z;
    this.velocities[k]=clamp(velocity.x,-25,25);this.velocities[k+1]=clamp(velocity.y,-25,25);this.velocities[k+2]=clamp(velocity.z,-25,25);
    const diameter=clamp(Number.isFinite(size)?size:.012,.0015,.045);
    this.sizes[i]=diameter;this.ages[i]=0;this.seeds[i]=Math.random()*Math.PI*2;
    this.kinds[i]=kind==='powder'?1:kind==='chip'?2:kind==='clump'?0:diameter<.006?1:diameter<.017?2:Math.random()<.8?2:0;
    this.bounces[i]=0;this.alive[i]=1;this.collisionCeilings[i]=position.y;
    this.metrics.totalEmitted++;
  }

  sampleSurface(x,z){
    const ix=Math.round(x/CELL),iz=Math.round(z/CELL),key=`${ix},${iz}`;
    let entry=this.surfaceCache.get(key);
    if(entry!==undefined){
      if(entry&&entry.depth!==this.cliffs.accumulationDepth){
        entry.y+=(this.cliffs.accumulationDepth-entry.depth)/Math.max(.25,entry.ny);entry.depth=this.cliffs.accumulationDepth;
      }
      return entry;
    }
    if(this.rayBudget<=0)return undefined;
    this.rayBudget--;this.metrics.surfaceQueries++;
    const hit=this.cliffs.querySnowSurface(ix*CELL,iz*CELL);
    entry=hit?{x:ix*CELL,y:hit.point.y,z:iz*CELL,nx:hit.normal.x,ny:hit.normal.y,nz:hit.normal.z,depth:this.cliffs.accumulationDepth}:null;
    if(this.surfaceCache.size>=1200)this.surfaceCache.delete(this.surfaceCache.keys().next().value);
    this.surfaceCache.set(key,entry);return entry;
  }

  surfaceHeight(surface,x,z){return surface.y-(surface.nx*(x-surface.x)+surface.nz*(z-surface.z))/Math.max(.25,surface.ny);}

  addPatch(x,z,surface,amount=0,radius=.17){
    if(!surface||surface.ny<.28)return -1;
    const key=`${Math.round(x/PATCH_CELL)},${Math.round(z/PATCH_CELL)}`;
    let i=this.patchMap.get(key);
    if(i===undefined){
      if(this.patchCount>=PATCHES)return -1;
      i=this.patchCount++;this.patchMap.set(key,i);
      this.patchX[i]=x;this.patchZ[i]=z;this.patchRadius[i]=radius;
    }
    const k=i*3;this.patchY[i]=this.surfaceHeight(surface,this.patchX[i],this.patchZ[i]);
    this.patchNormals[k]=surface.nx;this.patchNormals[k+1]=surface.ny;this.patchNormals[k+2]=surface.nz;
    this.patchDepth[i]=this.cliffs.accumulationDepth;this.patchReady[i]=1;
    this.patchMass[i]=clamp(this.patchMass[i]+amount,0,value(this.settings,'accumulationMax',.12,0,.3));
    return i;
  }

  queueWeatherGrid(contact){
    // A fixed grid covers the tops of both rocks, with a finer contact neighbourhood.
    this.pendingWeather.length=0;
    for(let x=-5.6;x<=5.6;x+=.62)for(let z=-1.65;z<=1.45;z+=.62){
      if(x>-.7&&x<.1)continue;
      this.pendingWeather.push({x,z,radius:.29+Math.random()*.12});
    }
    for(let ring=1;ring<=3;ring++)for(let j=0;j<12;j++){
      const angle=j/12*Math.PI*2,dist=ring*.43;
      this.pendingWeather.unshift({x:contact.x+Math.cos(angle)*dist,z:contact.z+Math.sin(angle)*dist,radius:.16+ring*.025});
    }
  }

  reset({empty=false}={}){
    this.cursor=0;this.highWater=0;this.alive.fill(0);this.ages.fill(0);this.patchMass.fill(0);this.patchReady.fill(0);
    this.surfaceCache.clear();this.patchMap.clear();this.patchCount=0;this.patchCursor=0;this.rayBudget=8;
    this.weatherDepth=empty||this.settings.accumulationEnabled===false?0:Math.min(.002,value(this.settings,'accumulationMax',.12,0,.3));this.layerTimer=0;this.refreshTimer=0;
    this.cliffs.setAccumulation(this.weatherDepth);this.surfaceKey='';this.lastContactX=NaN;this.lastContactZ=NaN;
    const contact=this.cliffs.contactPoint||{x:1.12,y:-1.1,z:.55};this.queueWeatherGrid(contact);
    if(!empty&&this.settings.accumulationEnabled!==false){
      for(let i=0;i<8;i++){
        const angle=i/8*Math.PI*2,x=contact.x+Math.cos(angle)*.45,z=contact.z+Math.sin(angle)*.45,surface=this.sampleSurface(x,z);
        this.addPatch(x,z,surface,.002+Math.random()*.002,.22+Math.random()*.08);
      }
    }
    Object.assign(this.metrics,{active:0,activeChunks:0,activePowder:0,landed:0,depositedPatches:this.patchCount,accumulationDepth:this.cliffs.accumulationDepth,surfaceQueries:0,totalEmitted:0});
    this.debris.count=0;this.powder.geometry.setDrawRange(0,0);this.renderPiles();
  }

  renderPiles(){
    const max=value(this.settings,'accumulationMax',.12,0,.3);let count=0;
    for(let i=0;i<this.patchCount;i++){
      const height=Math.min(max,this.patchMass[i]);if(!this.patchReady[i]||height<.001)continue;
      const k=i*3,nx=this.patchNormals[k],ny=this.patchNormals[k+1],nz=this.patchNormals[k+2];
      const depth=this.cliffs.accumulationDepth-this.patchDepth[i];
      this.position.set(this.patchX[i],this.patchY[i]+depth/Math.max(.25,ny),this.patchZ[i]).addScaledVector(this.normal.set(nx,ny,nz),.001);
      this.quaternion.setFromUnitVectors(this.up,this.normal);
      const radius=this.patchRadius[i]*(.68+Math.min(1,height/.04)*.32);
      this.scale.set(radius,height,radius*.86);this.matrix.compose(this.position,this.quaternion,this.scale);this.piles.setMatrixAt(count++,this.matrix);
    }
    this.piles.count=count;this.piles.visible=this.settings.accumulationEnabled!==false;
    uploadActiveRange(this.piles.instanceMatrix,count);
    this.metrics.depositedPatches=count;
  }

  update(dt,{contact,settings=this.settings,time=0,rpm=0}={}){
    this.settings=settings;dt=Number.isFinite(dt)?clamp(dt,0,.1):0;
    contact=contact?.point||contact?.position||contact||this.cliffs.contactPoint;
    if(!validVector(contact))contact=this.cliffs.contactPoint;
    const enabled=settings.accumulationEnabled!==false,max=value(settings,'accumulationMax',.12,0,.3);
    const adhesion=value(settings,'snowAdhesion',.65,0,1),rate=value(settings,'accumulationRate',1,0,10),shedding=value(settings,'snowShedding',1,0,5);
    const weather=clamp(value(settings,'snowfall',6,0,30)/6,0,3);
    const key=`${settings.hillHeight??1},${settings.snowDepth??.025}`;
    this.rayBudget=6;
    if(this.surfaceKey!==key){
      this.surfaceKey=key;this.surfaceCache.clear();this.patchReady.fill(0);this.refreshTimer=.25;
    }
    if(!Number.isFinite(this.lastContactX)||Math.hypot(contact.x-this.lastContactX,contact.z-this.lastContactZ)>.6){
      this.lastContactX=contact.x;this.lastContactZ=contact.z;this.queueWeatherGrid(contact);
    }
    this.layerTimer+=dt;this.refreshTimer+=dt;
    this.weatherDepth=enabled?Math.min(max,this.weatherDepth+dt*.0016*rate*weather):0;
    if(this.layerTimer>=.25){this.layerTimer%=.25;this.cliffs.setAccumulation(this.weatherDepth);}
    if(this.pendingWeather.length&&this.rayBudget>0){
      let attempts=0;
      while(this.pendingWeather.length&&this.rayBudget>2&&attempts++<5){
        const candidate=this.pendingWeather.shift(),surface=this.sampleSurface(candidate.x,candidate.z);
        if(surface===undefined){this.pendingWeather.unshift(candidate);break;}
        if(surface)this.addPatch(candidate.x,candidate.z,surface,0,candidate.radius);
      }
    }
    // Refresh only a few existing patches each frame after a manual terrain change.
    for(let j=0;j<3&&this.patchCount;j++){
      const i=this.patchCursor++%this.patchCount;
      if(this.patchReady[i])continue;
      const surface=this.sampleSurface(this.patchX[i],this.patchZ[i]);
      if(surface)this.addPatch(this.patchX[i],this.patchZ[i],surface);
    }
    const underTyre=Math.min(4,Math.abs(Number.isFinite(rpm)?rpm:0)/85)*shedding;
    for(let i=0;i<this.patchCount;i++){
      const slope=this.patchNormals[i*3+1];
      const distance=Math.hypot(this.patchX[i]-contact.x,this.patchZ[i]-contact.z);
      // Regional snowfall grows the coherent cap; only the tyre neighbourhood
      // needs extra local mounds in addition to actual landed wheel debris.
      if(enabled&&distance<.9)this.patchMass[i]=Math.min(max,this.patchMass[i]+dt*.00018*rate*weather*slope*slope*(1-distance/.9));
      else this.patchMass[i]=Math.min(max,this.patchMass[i]);
      if(distance<.48)this.patchMass[i]=Math.max(0,this.patchMass[i]-dt*.018*underTyre*(1-distance/.48));
    }
    const wind=value(settings,'windSpeed',2.2,0,20),angle=THREE.MathUtils.degToRad(value(settings,'windDirection',-15,-360,360));
    const windX=Math.cos(angle)*wind*.08,windZ=Math.sin(angle)*wind*.08;let active=0,chunks=0,powder=0,points=0,chips=0;
    const powderDrag=Math.exp(-1.2*dt),chipDrag=Math.exp(-.23*dt);
    for(let i=0;i<this.highWater;i++){
      if(!this.alive[i])continue;
      const k=i*3,isPowder=this.kinds[i]===1,isChip=this.kinds[i]===2,size=this.sizes[i],previousY=this.positions[k+1];this.ages[i]+=dt;
      if(this.ages[i]>(isPowder?6:12)||previousY< -22){this.alive[i]=0;continue;}
      const drag=isPowder?powderDrag:chipDrag;
      this.velocities[k]=(this.velocities[k]+windX*dt)*drag;this.velocities[k+2]=(this.velocities[k+2]+windZ*dt)*drag;
      this.velocities[k+1]=(this.velocities[k+1]-(isPowder?4.8:9.81)*dt)*drag;
      this.positions[k]+=this.velocities[k]*dt;this.positions[k+1]+=this.velocities[k+1]*dt;this.positions[k+2]+=this.velocities[k+2]*dt;
      const x=this.positions[k],z=this.positions[k+2];
      if(this.velocities[k+1]<0&&this.ages[i]>.035){
        const surface=this.sampleSurface(x,z);
        if(surface!==undefined){
          if(surface){
            const ground=this.surfaceHeight(surface,x,z),radius=size*.5;
            if(this.positions[k+1]<=ground+radius&&this.collisionCeilings[i]>=ground-radius-.065){
              const nx=surface.nx,ny=surface.ny,nz=surface.nz;
              const impact=this.velocities[k]*nx+this.velocities[k+1]*ny+this.velocities[k+2]*nz;
              this.positions[k+1]=ground+radius+.003;
              if(!isPowder&&!this.bounces[i]&&impact< -1.2&&Math.random()>adhesion*.85){
                const bounce=.12+(1-adhesion)*.16;
                this.velocities[k]=(this.velocities[k]-(1+bounce)*impact*nx)*.52;
                this.velocities[k+1]=(this.velocities[k+1]-(1+bounce)*impact*ny)*.52;
                this.velocities[k+2]=(this.velocities[k+2]-(1+bounce)*impact*nz)*.52;this.bounces[i]=1;
              }else{
                if(enabled){const amount=clamp(size*size*size/.05,.000001,.004)*(isPowder?.12:1)*(.25+adhesion*.75);this.addPatch(x,z,surface,amount,.075+size*1.8);}
                this.metrics.landed++;this.alive[i]=0;continue;
              }
            }
          }
          this.collisionCeilings[i]=this.positions[k+1];
        }
      }else this.collisionCeilings[i]=Math.max(this.collisionCeilings[i],this.positions[k+1]);
      active++;
      if(isPowder||isChip){
        const p=points*3;this.powderPositions[p]=x;this.powderPositions[p+1]=this.positions[k+1];this.powderPositions[p+2]=z;
        this.powderSizes[points]=size*(isPowder?1+this.ages[i]*.08:1);
        this.powderAlpha[points]=(1-smoothFade(this.ages[i],isPowder?3.2:5.5))*(isPowder?.36:.94);
        this.powderKinds[points]=isPowder?1:0;this.powderAngles[points]=this.seeds[i]+this.ages[i]*(isPowder?.3:2.4);
        points++;if(isPowder)powder++;else chips++;
      }else{
        this.position.set(x,this.positions[k+1],z);this.euler.set(this.seeds[i]+this.ages[i]*1.8,this.seeds[i]*.7+this.ages[i]*2.1,time*.3);
        this.quaternion.setFromEuler(this.euler);this.scale.set(size,size*.72,size*.85);this.matrix.compose(this.position,this.quaternion,this.scale);this.fragmentSeeds[chunks]=this.seeds[i];this.debris.setMatrixAt(chunks++,this.matrix);
      }
    }
    this.debris.count=chunks;this.debris.visible=chunks>0;
    uploadActiveRange(this.debris.instanceMatrix,chunks);
    uploadActiveRange(this.debris.geometry.attributes.aFragmentSeed,chunks);
    this.powder.geometry.setDrawRange(0,points);this.powder.visible=points>0;
    if(points)for(const attribute of Object.values(this.powder.geometry.attributes))uploadActiveRange(attribute,points);
    if(this.refreshTimer>=.25){
      this.refreshTimer%=.25;this.debris.material.color.set(settings.snowColor||'#e7ebf2');this.piles.material.color.copy(this.debris.material.color).multiplyScalar(.56);
      this.pileUniforms.uPileGrain.value=settings.snowGrain??.012;this.pileUniforms.uPileScale.value=settings.snowScale??46;
      this.powder.material.uniforms.uColor.value.copy(this.debris.material.color);this.renderPiles();
    }
    Object.assign(this.metrics,{active,activeChunks:chunks+chips,activePowder:powder,activeClumps:chunks,activeChips:chips,accumulationDepth:this.cliffs.accumulationDepth});
  }
}
