import * as THREE from 'three';
import { crownRadius } from './wheel-geometry.js';

const clamp=THREE.MathUtils.clamp;
function setting(settings,key,fallback,min,max){const value=settings[key];return clamp(Number.isFinite(value)?value:fallback,min,max);}

function contactFlakeGeometry(){
  const outline=[[-.48,-.2],[-.19,-.41],[.3,-.29],[.48,.04],[.15,.39],[-.37,.25]],positions=[],indices=[],n=outline.length;
  for(let layer=0;layer<2;layer++)for(let i=0;i<n;i++){const [x,z]=outline[i];positions.push(x,layer===0?.07+Math.sin(i*2.3)*.035:-.065,z);}
  const top=positions.length/3;positions.push(.03,.14,-.02);const bottom=positions.length/3;positions.push(0,-.09,0);
  for(let i=0;i<n;i++){const j=(i+1)%n;indices.push(top,j,i,bottom,n+i,n+j,i,j,n+i,j,n+j,n+i);}
  const indexed=new THREE.BufferGeometry();indexed.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));indexed.setIndex(indices);
  const geometry=indexed.toNonIndexed();indexed.dispose();geometry.computeVertexNormals();return geometry;
}

export class ContactSnow {
  constructor(pixelRatio=1) {
    // A fixed pool keeps memory bounded; lifetime-aware emission preserves the plume.
    this.count=60000;this.cursor=0;this.carry=0;this.pending=0;this.highWater=0;this.activeCount=0;
    this.birthUploadStart=0;this.birthUploadCount=0;
    this.positions=new Float32Array(this.count*3).fill(1000);
    this.velocities=new Float32Array(this.count*3);
    this.ages=new Float32Array(this.count);this.lives=new Float32Array(this.count);
    this.sizes=new Float32Array(this.count);this.kinds=new Float32Array(this.count);
    this.bounces=new Uint8Array(this.count);this.ceilings=new Float32Array(this.count);this.birthSteps=new Float32Array(this.count).fill(-1);this.surfaceCache=new Map();
    this.launchNormals=new Float32Array(this.count*3);this.loftTargets=new Float32Array(this.count);this.loftDelivered=new Float32Array(this.count);
    this.wheelInverse=new THREE.Matrix4();this.wheelNormalMatrix=new THREE.Matrix3();this.hasWheel=false;this.lastTyreDeflections=0;
    this.lastSurfaceQueries=0;this.lastBounceCount=0;
    this.seeds=Float32Array.from({length:this.count},()=>Math.random()*Math.PI*2);
    this.flutterCos=Float32Array.from(this.seeds,seed=>Math.cos(seed*1.9));
    this.flutterSin=Float32Array.from(this.seeds,seed=>Math.sin(seed*1.9));
    this.flakeWidths=Float32Array.from(this.seeds,seed=>.84+.20*Math.sin(seed));
    this.flakeHeights=Float32Array.from(this.seeds,seed=>.7+.22*Math.cos(seed));
    this.lastEmissionOrigin=new THREE.Vector3();this.lastEmissionCount=0;this.lastAliveCount=0;
    this.lastBirthPosition=new THREE.Vector3();this.lastSpawnCenter=new THREE.Vector3();this.lastSpawnRadius=0;
    this.normal=new THREE.Vector3();this.tangent=new THREE.Vector3();this.cross=new THREE.Vector3();
    const geometry=new THREE.BufferGeometry();
    for(const [name,array,itemSize] of [['position',this.positions,3],['aAge',this.ages,1],['aLife',this.lives,1],['aSize',this.sizes,1],['aKind',this.kinds,1]])geometry.setAttribute(name,new THREE.BufferAttribute(array,itemSize).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSeed',new THREE.BufferAttribute(this.seeds,1));
    // Draw only live points and skip flakes already rendered as instances.
    this.pointIndices=new Uint16Array(this.count);
    geometry.setIndex(new THREE.BufferAttribute(this.pointIndices,1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0,0);
    this.material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{uRatio:{value:pixelRatio}},
      vertexShader:`attribute float aAge;attribute float aLife;attribute float aSize;attribute float aKind;attribute float aSeed;uniform float uRatio;varying float vAlpha;varying float vKind;varying float vAngle;varying float vSeed;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;float life=clamp(aAge/max(aLife,.001),0.,1.);float powder=step(.8,aKind);vAlpha=(1.-smoothstep(.68,1.,life))*smoothstep(0.,.008,aAge)*step(.001,aLife);vKind=aKind;vSeed=aSeed;vAngle=aSeed+aAge*(1.4+sin(aSeed)*4.);gl_PointSize=clamp(aSize*(1.+life*powder*.35)*1250.*uRatio/max(1.,-mv.z),mix(1.35,1.,powder),mix(15.,11.,powder));}`,
      fragmentShader:`varying float vAlpha;varying float vKind;varying float vAngle;varying float vSeed;
      void main(){
        if(vAlpha<.001)discard;
        vec2 p=(gl_PointCoord-.5)*2.;float c=cos(vAngle),s=sin(vAngle);p=mat2(c,-s,s,c)*p;
        float powder=step(.8,vKind);float chip=step(.22,vKind)*(1.-powder);float clump=step(.62,vKind)*(1.-powder);
        vec2 q=p*vec2(1.+chip*.35,1.+chip*.08);
        float edge=max(abs(q.x)*.73+abs(q.y)*.57,abs(q.y)*.94);
        edge+=sin(q.x*11.+vSeed)*sin(q.y*13.-vSeed)*.065;
        edge+=clump*(sin(atan(q.y,q.x)*5.+vSeed)*.075);
        float solid=(1.-smoothstep(.64,.86,edge))*(.9+.1*sin(q.x*7.+q.y*11.+vSeed));
        float fine=pow(max(0.,1.-length(p)),1.35);
        float alpha=mix(solid*.98,fine*.43,powder)*vAlpha;
        if(alpha<.015)discard;
        float facet=clamp(.72+q.x*.18-q.y*.12+sin(vSeed+vAngle*.3)*.11,.46,1.);
        vec3 color=mix(vec3(.63,.74,.85),vec3(1.05,1.075,1.1),facet);
        gl_FragColor=vec4(color,alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`});
    this.mesh=new THREE.Points(geometry,this.material);this.mesh.frustumCulled=false;this.mesh.visible=false;this.mesh.renderOrder=20;this.mesh.name='Dense granular snow, chips and restrained powder at tyre contact';
    const flakeMaterial=new THREE.MeshStandardMaterial({color:0xe3effa,roughness:.94,metalness:0,envMapIntensity:.28,transparent:true,opacity:.96,depthWrite:false,depthTest:true,side:THREE.DoubleSide});
    this.flakes=new THREE.InstancedMesh(contactFlakeGeometry(),flakeMaterial,2800);this.flakes.name='Solid broken snow flakes in the contact jet';
    this.flakes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.flakes.count=0;this.flakes.frustumCulled=false;this.flakes.renderOrder=20;
    this.mesh.add(this.flakes);this.flakeMatrix=new THREE.Matrix4();this.flakePosition=new THREE.Vector3();this.flakeScale=new THREE.Vector3();this.flakeQuaternion=new THREE.Quaternion();this.flakeEuler=new THREE.Euler();
  }
  burst(count=1200){this.pending=Math.min(this.count,this.pending+Math.max(0,Math.floor(Number.isFinite(count)?count:0)));}
  clear(){
    this.cursor=0;this.carry=0;this.pending=0;this.highWater=0;this.activeCount=0;
    this.lives.fill(0);this.ages.fill(0);this.positions.fill(1000);
    this.lastEmissionCount=0;this.lastAliveCount=0;this.mesh.visible=false;this.mesh.geometry.setDrawRange(0,0);
    this.flakes.count=0;
    this.bounces.fill(0);this.surfaceCache.clear();this.lastSurfaceQueries=0;this.lastBounceCount=0;
    this.birthSteps.fill(-1);this.birthUploadCount=0;this.lastBirthPosition.set(0,0,0);this.lastSpawnCenter.set(0,0,0);this.lastSpawnRadius=0;
    this.loftTargets.fill(0);this.loftDelivered.fill(0);this.lastTyreDeflections=0;
  }
  configuration(settings){
    return {
      amount:setting(settings,'sprayAmount',9,0,24),spread:setting(settings,'spraySpread',1.8,.05,5),size:setting(settings,'spraySize',1.15,.1,4),
      speed:setting(settings,'spraySpeed',1,.05,5),lifetime:setting(settings,'sprayLifetime',1.8,.1,4),lift:setting(settings,'sprayLift',1.7,0,4),
      gravity:setting(settings,'sprayGravity',5.4,0,12),mist:setting(settings,'sprayMist',.12,0,1),turbulence:setting(settings,'sprayTurbulence',.7,0,4),
      wind:setting(settings,'windSpeed',2.2,0,20),windDirection:THREE.MathUtils.degToRad(setting(settings,'windDirection',-15,-360,360)),
    };
  }
  prepareBasis(normal,tangent){
    this.normal.copy(normal);if(this.normal.lengthSq()<1e-10)this.normal.set(0,1,0);else this.normal.normalize();
    this.tangent.copy(tangent).addScaledVector(this.normal,-tangent.dot(this.normal));
    if(this.tangent.lengthSq()<1e-10){this.tangent.set(Math.abs(this.normal.x)<.9?1:0,Math.abs(this.normal.x)<.9?0:1,0);this.tangent.addScaledVector(this.normal,-this.tangent.dot(this.normal));}
    this.tangent.normalize();this.cross.crossVectors(this.normal,this.tangent).normalize();
  }
  emitParticle(contact,rpm,config,firstStep=-1){
    const i=this.cursor,k=i*3;this.cursor=(this.cursor+1)%this.count;this.highWater=Math.max(this.highWater,i+1);
    if(this.birthUploadCount===0)this.birthUploadStart=i;
    this.birthUploadCount=Math.min(this.count,this.birthUploadCount+1);
    if(this.lives[i]<=0)this.activeCount++;
    const mist=Math.random()<config.mist,chunk=!mist&&Math.random()>.83,chip=!mist&&!chunk&&Math.random()>.38;
    const frontWing=Math.random()<.58;
    // Snow is born in the real contact patch. The wide fan is velocity spread,
    // never a translated source beside the tyre or out on the rock.
    const along=(Math.random()-.5)*.036,across=(Math.random()-.5)*.08,out=.001+Math.random()*.002;
    const n=this.normal,t=this.tangent,c=this.cross;
    this.positions[k]=contact.x+t.x*along+c.x*across+n.x*out;
    this.positions[k+1]=contact.y+t.y*along+c.y*across+n.y*out;
    this.positions[k+2]=contact.z+t.z*along+c.z*across+n.z*out;
    this.lastBirthPosition.set(this.positions[k],this.positions[k+1],this.positions[k+2]);
    const speed=(1.6+Math.abs(rpm)*.045)*config.speed;
    const forward=speed*(mist?.55+Math.random()*.55:.72+Math.random()*.62);
    const fan=(frontWing?.45+Math.random()*1.55:(Math.random()-.5)*2.35)*config.spread;
    // A rock-surface tangent can point downhill. Offset that downward component
    // before adding loft, so the fan rises visibly instead of diving at launch.
    const rise=(.65+Math.random()*1.05)*config.lift*(mist?.82:1);
    const baseLift=(.8+Math.random()*.9)*config.lift;
    const lift=n.y>.25?Math.max(baseLift,(rise-t.y*forward-c.y*fan)/n.y):baseLift;
    // The first grains shear through the contact patch. Loft is released only
    // after that path clears the casing, so snow cannot appear through letters.
    this.launchNormals[k]=n.x;this.launchNormals[k+1]=n.y;this.launchNormals[k+2]=n.z;
    this.loftTargets[i]=lift;this.loftDelivered[i]=0;
    this.velocities[k]=t.x*forward+c.x*fan;
    this.velocities[k+1]=t.y*forward+c.y*fan;
    this.velocities[k+2]=t.z*forward+c.z*fan;
    this.ages[i]=0;this.lives[i]=(mist?.65+Math.random()*.45:.52+Math.random()*.40)*config.lifetime;
    this.sizes[i]=Math.min(mist?.04:chunk?.05:.038,(mist?.018+Math.random()*.020:chunk?.027+Math.random()*.017:chip?.018+Math.random()*.013:.012+Math.random()*.011)*config.size);
    this.kinds[i]=mist?.95:chunk?.72:chip?.38:.1;
    this.bounces[i]=0;this.ceilings[i]=this.positions[k+1];this.birthSteps[i]=firstStep;
  }
  emit(contact,normal,tangent,rpm,settings){this.prepareBasis(normal,tangent);this.emitParticle(contact,rpm,this.configuration(settings));}
  tyreContains(x,y,z,radialGuard=false){
    const m=this.wheelInverse.elements,lx=m[0]*x+m[4]*y+m[8]*z+m[12],ly=m[1]*x+m[5]*y+m[9]*z+m[13],lz=m[2]*x+m[6]*y+m[10]*z+m[14];
    return this.tyreContainsLocal(lx,ly,lz,radialGuard);
  }
  tyreContainsLocal(lx,ly,lz,radialGuard){
    const az=Math.abs(lz);if(!radialGuard&&az>.468)return false;
    const radiusSquared=lx*lx+ly*ly;
    if(radiusSquared<1.065**2||radiusSquared>=this.tyreOuterSquared)return false;
    const outer=radialGuard?crownRadius(clamp(lz,-.43,.43))+this.tyreDepth*(1-THREE.MathUtils.smoothstep(Math.min(az,.43),.35,.43))+.006:az<=.43?crownRadius(lz)+this.tyreDepth*(1-THREE.MathUtils.smoothstep(az,.35,.43))+.002:THREE.MathUtils.lerp(1.414,1.18,clamp((az-.43)/.035,0,1))+.002;
    return radiusSquared<outer*outer;
  }
  pathHitsTyre(x,y,z,vx,vy,vz,step,radialGuard=false){
    if(!this.hasWheel)return false;
    const m=this.wheelInverse.elements;
    const lx=m[0]*x+m[4]*y+m[8]*z+m[12],ly=m[1]*x+m[5]*y+m[9]*z+m[13],lz=m[2]*x+m[6]*y+m[10]*z+m[14];
    const t=step*.25;
    const dx=(m[0]*vx+m[4]*vy+m[8]*vz)*t,dy=(m[1]*vx+m[5]*vy+m[9]*vz)*t,dz=(m[2]*vx+m[6]*vy+m[10]*vz)*t;
    // A segment moving away from the wheel and already outside its maximum
    // radius cannot touch the casing at any of the four samples.
    if(lx*lx+ly*ly>=this.tyreOuterSquared&&lx*dx+ly*dy>=0)return false;
    for(let sample=1;sample<=4;sample++){
      if(this.tyreContainsLocal(lx+dx*sample,ly+dy*sample,lz+dz*sample,radialGuard))return true;
    }
    return false;
  }
  shearTyreVelocity(k,step){
    const x=this.positions[k],y=this.positions[k+1],z=this.positions[k+2],vx=this.velocities[k],vy=this.velocities[k+1],vz=this.velocities[k+2];
    if(!this.pathHitsTyre(x,y,z,vx,vy,vz,step,true))return;
    const m=this.wheelInverse.elements,px=x+vx*step,py=y+vy*step,pz=z+vz*step;
    const lx=m[0]*px+m[4]*py+m[8]*pz+m[12],ly=m[1]*px+m[5]*py+m[9]*pz+m[13],lz=m[2]*px+m[6]*py+m[10]*pz+m[14],r=Math.max(.01,Math.hypot(lx,ly));
    const slope=Math.abs(lz)<=.43?-.38*lz*lz*lz/(.43**4):0;
    const a=this.wheelNormalMatrix.elements,gx=lx/r,gy=ly/r,gz=-slope;
    let nx=a[0]*gx+a[3]*gy+a[6]*gz,ny=a[1]*gx+a[4]*gy+a[7]*gz,nz=a[2]*gx+a[5]*gy+a[8]*gz;
    const length=Math.hypot(nx,ny,nz);nx/=length;ny/=length;nz/=length;
    const inward=vx*nx+vy*ny+vz*nz;
    if(inward<0){
      this.velocities[k]-=nx*inward;this.velocities[k+1]-=ny*inward;this.velocities[k+2]-=nz*inward;
      const removedLoft=inward*(nx*this.launchNormals[k]+ny*this.launchNormals[k+1]+nz*this.launchNormals[k+2]);
      this.loftDelivered[k/3]=Math.max(0,this.loftDelivered[k/3]-Math.max(0,removedLoft));this.lastTyreDeflections++;
    }
  }
  update(dt,{contact,normal,tangent,rpm,settings,time=0,terrain,wheelRoot}){
    dt=Number.isFinite(dt)?clamp(dt,0,.25):0;rpm=Number.isFinite(rpm)?rpm:0;
    if(this.activeCount===0&&this.pending===0&&Math.abs(rpm)<=.5){
      this.lastEmissionOrigin.copy(contact);this.lastSpawnCenter.copy(contact);this.lastSpawnRadius=0;
      this.lastEmissionCount=0;this.lastAliveCount=0;this.lastSurfaceQueries=0;this.lastBounceCount=0;this.lastTyreDeflections=0;
      return;
    }
    const config=this.configuration(settings);this.prepareBasis(normal,tangent);
    this.hasWheel=!!wheelRoot?.isObject3D;this.tyreDepth=setting(settings,'treadDepth',.055,.005,.2);this.lastTyreDeflections=0;
    this.tyreOuterSquared=(crownRadius(0)+this.tyreDepth+.006)**2;
    if(this.hasWheel){wheelRoot.updateWorldMatrix(true,false);this.wheelInverse.copy(wheelRoot.matrixWorld).invert();this.wheelNormalMatrix.getNormalMatrix(wheelRoot.matrixWorld);}
    const scaleTime=Math.sqrt(setting(settings,'wheelScale',1,.35,2.3)),loftStart=.07*scaleTime,loftEnd=.18*scaleTime,youngUntil=.55*scaleTime;
    const speedLoad=Math.min(1.45,Math.abs(rpm)/120);
    const requestedRate=Math.abs(rpm)>.5?4200*Math.pow(speedLoad,.85)*config.amount:0;
    // High rpm must fill the plume rather than recycle every slot near its origin.
    // Keep a full age distribution for roughly one average particle lifetime.
    const rate=Math.min(requestedRate,this.count/(.72*config.lifetime));
    this.carry+=rate*dt;
    const emitCount=Math.min(this.count,Math.floor(this.carry)+this.pending);this.carry%=1;this.pending=0;
    this.lastSpawnCenter.set(0,0,0);this.lastSpawnRadius=0;
    for(let i=0;i<emitCount;i++){
      // Birth times cover the frame, filling the stream all the way back to
      // contact instead of moving every new grain a full frame away at once.
      this.emitParticle(contact,Math.max(20,Math.abs(rpm)),config,dt*(i+Math.random())/emitCount);
      this.lastSpawnCenter.add(this.lastBirthPosition);
      this.lastSpawnRadius=Math.max(this.lastSpawnRadius,this.lastBirthPosition.distanceTo(contact));
    }
    if(emitCount)this.lastSpawnCenter.multiplyScalar(1/emitCount);else this.lastSpawnCenter.copy(contact);
    const windX=Math.cos(config.windDirection)*config.wind*.08,windZ=Math.sin(config.windDirection)*config.wind*.08;
    const flutterTime=time*1.7,flutterCos=Math.cos(flutterTime)*config.turbulence,flutterSin=Math.sin(flutterTime)*config.turbulence;
    const turbulenceTime=time*2.4,mistDrag=Math.exp(-.75*dt),grainDrag=Math.exp(-.13*dt);
    const accumulationDepth=terrain?.accumulationDepth??0;
    let flakeCount=0,pointCount=0;this.lastSurfaceQueries=0;this.lastBounceCount=0;
    const surfaceKey=`${settings.hillHeight??1},${settings.snowDepth??.025}`;
    if(this.surfaceKey!==surfaceKey){this.surfaceKey=surfaceKey;this.surfaceCache.clear();}
    for(let i=0;i<this.highWater;i++){
      if(this.lives[i]<=0)continue;
      const particleStep=this.birthSteps[i]>=0?Math.min(dt,this.birthSteps[i]):dt;this.birthSteps[i]=-1;this.ages[i]+=particleStep;
      if(this.ages[i]>=this.lives[i]){this.lives[i]=0;this.activeCount--;continue;}
      const k=i*3,mist=this.kinds[i]>.8,seed=this.seeds[i];
      const turbulence=Math.sin(turbulenceTime+seed+this.ages[i]*2.1)*config.turbulence;
      const flutter=flutterCos*this.flutterCos[i]-flutterSin*this.flutterSin[i];
      this.velocities[k]+=(windX+turbulence*(mist?.55:.08))*particleStep;
      this.velocities[k+1]-=config.gravity*(mist?.55:1)*particleStep;
      this.velocities[k+2]+=(windZ+flutter*(mist?.45:.065))*particleStep;
      const drag=particleStep===dt?(mist?mistDrag:grainDrag):Math.exp(-(mist?.75:.13)*particleStep);
      this.velocities[k]*=drag;this.velocities[k+2]*=drag;
      const young=this.ages[i]<youngUntil;
      if(young)this.shearTyreVelocity(k,particleStep);
      const phase=THREE.MathUtils.smoothstep(this.ages[i],loftStart,loftEnd),target=this.loftTargets[i]*phase;
      const add=Math.min(Math.max(0,target-this.loftDelivered[i]),this.loftTargets[i]*particleStep/(.10*scaleTime));
      if(add>0){
        const nx=this.launchNormals[k],ny=this.launchNormals[k+1],nz=this.launchNormals[k+2];
        const vx=this.velocities[k]+nx*add,vy=this.velocities[k+1]+ny*add,vz=this.velocities[k+2]+nz*add;
        if(!young||!this.pathHitsTyre(this.positions[k],this.positions[k+1],this.positions[k+2],vx,vy,vz,particleStep,true)){
          this.velocities[k]=vx;this.velocities[k+1]=vy;this.velocities[k+2]=vz;this.loftDelivered[i]+=add;
        }
      }
      this.positions[k]+=this.velocities[k]*particleStep;this.positions[k+1]+=this.velocities[k+1]*particleStep;this.positions[k+2]+=this.velocities[k+2]*particleStep;
      if(mist&&!young)this.positions[k+1]+=flutter*particleStep*.10;
      this.ceilings[i]=Math.max(this.ceilings[i],this.positions[k+1]);
      if(terrain?.querySnowSurface&&this.velocities[k+1]<0&&this.bounces[i]<2){
        const cell=.24,x=this.positions[k],z=this.positions[k+2],ix=Math.round(x/cell),iz=Math.round(z/cell);
        // Particle travel is far below the 65,536 cells reserved per row.
        const key=iz*65536+ix;
        let surface=this.surfaceCache.get(key);
        if(surface===undefined&&this.lastSurfaceQueries<4){
          const hit=terrain.querySnowSurface(ix*cell,iz*cell);this.lastSurfaceQueries++;
          surface=hit?{x:ix*cell,y:hit.point.y,z:iz*cell,nx:hit.normal.x,ny:hit.normal.y,nz:hit.normal.z,depth:accumulationDepth}:null;
          if(this.surfaceCache.size>=1600)this.surfaceCache.delete(this.surfaceCache.keys().next().value);
          this.surfaceCache.set(key,surface);
        }
        if(surface&&surface.ny>.25){
          const growth=accumulationDepth-surface.depth;
          const ground=surface.y+(growth-surface.nx*(x-surface.x)-surface.nz*(z-surface.z))/surface.ny;
          const radius=this.sizes[i]*.32;
          if(ground<=this.ceilings[i]+radius&&this.positions[k+1]<ground+radius&&(!young||!this.hasWheel||!this.tyreContains(x,ground+radius,z))){
            const vn=this.velocities[k]*surface.nx+this.velocities[k+1]*surface.ny+this.velocities[k+2]*surface.nz;
            if(vn<0){
              this.positions[k+1]=ground+radius;
              const rebound=mist?.16:.25;
              this.velocities[k]=(this.velocities[k]-(1+rebound)*vn*surface.nx)*.83;
              this.velocities[k+1]=(this.velocities[k+1]-(1+rebound)*vn*surface.ny)*.83;
              this.velocities[k+2]=(this.velocities[k+2]-(1+rebound)*vn*surface.nz)*.83;
              this.bounces[i]++;this.lastBounceCount++;
            }
          }
        }
      }
      if(this.kinds[i]>.62&&this.kinds[i]<.8&&flakeCount<2800&&this.ages[i]<this.lives[i]*.88){
        const size=Math.min(.05,Math.max(.025,this.sizes[i]));
        this.flakePosition.fromArray(this.positions,k);this.flakeEuler.set(seed+this.ages[i]*3.1,seed*.7+this.ages[i]*5.2,seed*.4+this.ages[i]*2.3);
        this.flakeQuaternion.setFromEuler(this.flakeEuler);this.flakeScale.set(size*this.flakeWidths[i],size*this.flakeHeights[i],size);
        this.flakeMatrix.compose(this.flakePosition,this.flakeQuaternion,this.flakeScale);this.flakes.setMatrixAt(flakeCount++,this.flakeMatrix);
      }else this.pointIndices[pointCount++]=i;
    }
    this.updateDrawBuffers(pointCount,flakeCount);
    this.lastEmissionOrigin.copy(contact);this.lastEmissionCount=emitCount;this.lastAliveCount=this.activeCount;
  }
  updateDrawBuffers(pointCount,flakeCount){
    const geometry=this.mesh.geometry;
    const {position,aAge,aLife,aSize,aKind}=geometry.attributes;
    if(this.birthUploadCount){
      const start=this.birthUploadStart,count=this.birthUploadCount;
      for(const attribute of [aLife,aSize,aKind]){
        attribute.addUpdateRange(start,Math.min(count,this.count-start));
        if(start+count>this.count)attribute.addUpdateRange(0,start+count-this.count);
        attribute.needsUpdate=true;
      }
      this.birthUploadCount=0;
    }
    if(pointCount){
      const first=this.pointIndices[0],span=this.pointIndices[pointCount-1]-first+1;
      position.addUpdateRange(first*3,span*3);position.needsUpdate=true;
      aAge.addUpdateRange(first,span);aAge.needsUpdate=true;
      geometry.index.addUpdateRange(0,pointCount);geometry.index.needsUpdate=true;
    }
    if(flakeCount){
      this.flakes.instanceMatrix.addUpdateRange(0,flakeCount*16);
      this.flakes.instanceMatrix.needsUpdate=true;
    }
    this.flakes.count=flakeCount;
    geometry.setDrawRange(0,pointCount);
    this.mesh.visible=this.activeCount>0;
  }
}
