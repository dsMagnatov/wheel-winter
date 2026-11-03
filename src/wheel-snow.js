import * as THREE from 'three';
import { crownRadius } from './wheel-geometry.js';

const TAU=Math.PI*2;
const COUNT=840;
const FILM_COLUMNS=70,FILM_ROWS=12;
const MAX_SHED_CALLBACKS=384;
const clamp=THREE.MathUtils.clamp;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const noise=(seed)=>{const value=Math.sin(seed*127.1+311.7)*43758.5453;return value-Math.floor(value);};
const read=(settings,key,fallback,min,max)=>Number.isFinite(settings?.[key])?clamp(settings[key],min,max):fallback;
const visibleHeight=(height)=>Math.min(.065,height*.38);

// Match the continuous tread surface, including channels, rather than putting
// separate white blocks on an imaginary cylinder outside the rubber.
function treadRadius(angle,z,depth){
  const phase=((angle/TAU*56+Math.abs(z)*3.5)%1+1)%1;
  const transverse=smooth(.055,.11,phase)*(1-smooth(.87,.93,phase));
  let longitudinal=1;
  for(const channel of [-.245,0,.245])longitudinal=Math.min(longitudinal,smooth(.009,.023,Math.abs(z-channel-Math.sin(angle*56)*.007)));
  return crownRadius(z)+depth*(1-smooth(.35,.43,Math.abs(z)))*Math.min(transverse,longitudinal);
}

function createFrostGeometry(depth){
  const around=448,across=44,positions=[],uvs=[],normals=[],grooves=[],indices=[];
  for(let i=0;i<=around;i++)for(let j=0;j<=across;j++){
    const angle=i/around*TAU,z=-.43+j/across*.86,radius=treadRadius(angle,z,depth);
    positions.push(Math.cos(angle)*radius,Math.sin(angle)*radius,z);uvs.push(i/around,j/across);
    // Analytic crown normals give the powder a soft connected surface rather
    // than copying each block edge into a separate raised white stamp.
    const slope=-.38*z*z*z/(.43**4),normal=new THREE.Vector3(Math.cos(angle),Math.sin(angle),-slope).normalize();
    normals.push(normal.x,normal.y,normal.z);
    grooves.push(Math.max(0,crownRadius(z)+depth*(1-smooth(.35,.43,Math.abs(z)))-radius));
    if(i<around&&j<across){const a=i*(across+1)+j,b=a+across+1;indices.push(a,b,a+1,b,b+1,a+1);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('aSnowGroove',new THREE.Float32BufferAttribute(grooves,1));geometry.setIndex(indices);
  geometry.computeBoundingSphere();geometry.boundingSphere.radius+=.1;
  return geometry;
}

// Model-locked simplex FBM coverage and finite-difference snow relief adapted
// from achrefelouafi/SnowSystemThreeJS, src/model.js (MIT).
// Copyright (c) 2026 mohamedachrefelouafi; full notice: public/licenses/.
// Stored mass replaces that source's world-up mask, so this layer rotates and
// sheds with the tyre instead of repainting itself onto whichever side is up.
const FROST_NOISE=`
vec3 snowPermute(vec3 x){return mod(((x*34.0)+1.0)*x,289.0);}
float snowSimplex(vec2 v){
  const vec4 C=vec4(.211324865405187,.366025403784439,-.577350269189626,.024390243902439);
  vec2 i=floor(v+dot(v,C.yy));vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=x0.x>x0.y?vec2(1.,0.):vec2(0.,1.);
  vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;i=mod(i,289.);
  vec3 p=snowPermute(snowPermute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
  vec3 m=max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);
  m=m*m;m=m*m;vec3 x=2.*fract(p*C.www)-1.,h=abs(x)-.5,ox=floor(x+.5),a0=x-ox;
  m*=1.79284291400159-.85373472095314*(a0*a0+h*h);
  vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.*dot(m,g);
}
float snowFbm(vec2 p){float result=0.,weight=.5;for(int i=0;i<5;i++){result+=weight*snowSimplex(p);p*=2.;weight*=.5;}return result;}
vec2 snowModelCoord(vec2 uv){float a=uv.x*6.28318530718;return vec2(sin(a)*1.8+cos(a)*.77,uv.y*.86+cos(a)*.17);}
float snowRelief(vec2 p){return snowFbm(p*7.1)*.72+snowFbm(p*21.7)*.20+snowSimplex(p*87.)*.08;}
`;

/** Attached snow lives in wheel coordinates; shed particles leave in world coordinates. */
export class WheelSnow {
  constructor({wheelRoot,wheelSpin,settings={},onShed}={}){
    if(!wheelRoot?.isObject3D||!wheelSpin?.isObject3D)throw new TypeError('WheelSnow needs wheelRoot and wheelSpin Object3D instances.');
    this.wheelRoot=wheelRoot;this.wheelSpin=wheelSpin;this.settings=settings;this.onShed=onShed;
    this.count=COUNT;this.heights=new Float32Array(COUNT);this.anchors=new Float32Array(COUNT*3);this.normals=new Float32Array(COUNT*3);
    this.rotations=new Float32Array(COUNT*4);this.widths=new Float32Array(COUNT*2);this.areas=new Float32Array(COUNT);
    this.filmIndices=new Uint16Array(COUNT*4);this.filmWeights=new Float32Array(COUNT*4);
    this.filmSums=new Float32Array(COUNT);this.filmTotals=new Float32Array(COUNT);this.filmPixels=new Uint8Array(COUNT*4);
    for(let i=3;i<this.filmPixels.length;i+=4)this.filmPixels[i]=255;
    this.pendingVolume=new Float32Array(COUNT);this.pendingPosition=new Float32Array(COUNT*3);this.pendingVelocity=new Float32Array(COUNT*3);
    this.shedCursor=0;this._shedCount=0;this.previousAngle=wheelSpin.rotation.z;this.disposed=false;
    this.group=new THREE.Group();this.group.name='Accumulated snow attached to the tyre';
    wheelSpin.add(this.group);
    this.localPosition=new THREE.Vector3();this.localNormal=new THREE.Vector3();this.worldPosition=new THREE.Vector3();this.worldNormal=new THREE.Vector3();
    this.center=new THREE.Vector3();this.axis=new THREE.Vector3();this.radial=new THREE.Vector3();this.velocity=new THREE.Vector3();
    this.tangent=new THREE.Vector3();this.bitangent=new THREE.Vector3();this.scale=new THREE.Vector3();this.quaternion=new THREE.Quaternion();
    this.matrix=new THREE.Matrix4();this.basis=new THREE.Matrix4();this.normalMatrix=new THREE.Matrix3();
    this.callbackPosition=new THREE.Vector3();this.callbackVelocity=new THREE.Vector3();this.depth=NaN;
    this.rebuildAnchors();this.createFrost();this.reset();
  }

  rebuildAnchors(){
    const depth=read(this.settings,'treadDepth',.055,.001,.2);this.depth=depth;
    this.filmTotals.fill(0);
    for(let i=0;i<COUNT;i++){
      const row=i%12,column=Math.floor(i/12);
      const angle=(column+noise(i+3)*.88+row*.37)/70*TAU;
      // Jittered rows include both rounded shoulders, without a repeated bead ring.
      const z=clamp(-.43+(row+.1+noise(i+71)*.8)/12*.86,-.428,.428);
      const radius=treadRadius(angle,z,depth)-.0012,k=i*3;
      this.localPosition.set(Math.cos(angle)*radius,Math.sin(angle)*radius,z);this.localPosition.toArray(this.anchors,k);
      const slope=-.38*z*z*z/(.43**4);
      this.localNormal.set(Math.cos(angle),Math.sin(angle),-slope).normalize();this.localNormal.toArray(this.normals,k);
      this.tangent.set(-Math.sin(angle),Math.cos(angle),0);this.bitangent.crossVectors(this.tangent,this.localNormal).normalize();
      this.basis.makeBasis(this.tangent,this.localNormal,this.bitangent);this.quaternion.setFromRotationMatrix(this.basis);
      this.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),noise(i+173)*TAU));this.quaternion.toArray(this.rotations,i*4);
      const width=.11+noise(i+103)*.07,length=.10+noise(i+151)*.065;
      this.widths[i*2]=width;this.widths[i*2+1]=length;
      // Stored depth represents loose snow before compaction into a low blanket.
      this.areas[i]=width*length*.58*.3;
      const u=THREE.MathUtils.euclideanModulo(angle/TAU,1)*FILM_COLUMNS-.5,v=(z+.43)/.86*FILM_ROWS-.5;
      const filmColumn=Math.floor(u),filmRow=Math.floor(v),fu=u-filmColumn,fv=v-filmRow;
      for(let corner=0;corner<4;corner++){
        const x=THREE.MathUtils.euclideanModulo(filmColumn+(corner%2),FILM_COLUMNS),y=clamp(filmRow+Math.floor(corner/2),0,FILM_ROWS-1);
        const index=y*FILM_COLUMNS+x,entry=i*4+corner;
        this.filmIndices[entry]=index;
        this.filmWeights[entry]=(corner%2?fu:1-fu)*(corner>1?fv:1-fv);
        this.filmTotals[index]+=this.filmWeights[entry];
      }
    }
    if(this.frostMesh){this.frostGeometry.dispose();this.frostGeometry=createFrostGeometry(depth);this.frostMesh.geometry=this.frostGeometry;this.geometry=this.frostGeometry;}
  }

  createFrost(){
    this.frostMap=new THREE.DataTexture(this.filmPixels,FILM_COLUMNS,FILM_ROWS,THREE.RGBAFormat,THREE.UnsignedByteType);
    this.frostMap.wrapS=THREE.RepeatWrapping;this.frostMap.wrapT=THREE.ClampToEdgeWrapping;
    this.frostMap.minFilter=THREE.LinearFilter;this.frostMap.magFilter=THREE.LinearFilter;this.frostMap.generateMipmaps=false;
    this.frostMaterial=new THREE.MeshStandardMaterial({color:this.settings.snowColor??'#e7ebf2',roughness:.96,metalness:0,envMapIntensity:.42,
      alphaMap:this.frostMap,transparent:true,opacity:1,alphaTest:.045,depthWrite:true,polygonOffset:true,polygonOffsetFactor:-1,
      stencilWrite:true,stencilRef:1,stencilFunc:THREE.AlwaysStencilFunc,stencilFail:THREE.KeepStencilOp,
      stencilZFail:THREE.KeepStencilOp,stencilZPass:THREE.ReplaceStencilOp});
    this.frostMaterial.onBeforeCompile=(shader)=>{
      shader.uniforms.uFrostMass={value:this.frostMap};
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
        uniform sampler2D uFrostMass;attribute float aSnowGroove;varying vec2 vSnowUv;
        ${FROST_NOISE}`)
        .replace('#include <begin_vertex>',`#include <begin_vertex>
          vSnowUv=uv;
          vec2 snowP=snowModelCoord(uv);
          vec2 snowMass=texture2D(uFrostMass,uv).rg;
          float snowLoad=snowMass.r*.3;
          float snowBroad=snowFbm(snowP*2.5+vec2(3.,7.))*.5+.5;
          float snowBody=smoothstep(.02,.30,snowMass.g);
          float snowDrift=smoothstep(.22,.76,snowBroad);
          float snowMeso=snowFbm(snowP*9.7+vec2(1.3,4.1))*.5+.5;
          float snowThickness=min(.065,snowLoad*.38)*(.20+snowDrift*.98+snowMeso*.15);
          float snowCrust=(snowRelief(snowP)+.6)*.0045*snowBody;
          transformed+=objectNormal*(.001+snowThickness+snowCrust+aSnowGroove*snowBody*.96);`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        varying vec2 vSnowUv;${FROST_NOISE}`)
        .replace('#include <color_fragment>',`#include <color_fragment>
          vec2 snowP=snowModelCoord(vSnowUv);
          float snowBroad=snowFbm(snowP*2.5+vec2(3.,7.))*.5+.5;
          float snowMeso=snowFbm(snowP*9.7+vec2(1.3,4.1))*.5+.5;
          float snowFine=snowFbm(snowP*37.1)*.5+.5;
          // Evaluate the relief once and differentiate before alpha clipping.
          float snowHeight=snowRelief(snowP)*.0035;
          vec2 snowSlope=vec2(dFdx(snowHeight),dFdy(snowHeight));
          vec3 snowDx=dFdx(-vViewPosition),snowDy=dFdy(-vViewPosition);
          // Soft blue-grey occlusion in the hollows makes the drift volume
          // legible under bright studio light, without black noise speckles.
          vec3 snowCavityTint=mix(vec3(.81,.88,.96),vec3(1.),smoothstep(.25,.72,snowBroad));
          diffuseColor.rgb*=snowCavityTint*(.67+snowBroad*.19+snowMeso*.07+snowFine*.025);`)
        .replace('#include <alphamap_fragment>',`#ifdef USE_ALPHAMAP
          float frostMass=texture2D(alphaMap,vAlphaMapUv).g;
          float shoreline=snowBroad*.64+snowMeso*.25+snowFine*.11;
          float fringe=smoothstep(.025,.27,frostMass+(shoreline-.5)*.25);
          // A dense interior with a narrow granular shoreline. There are no
          // independently alpha-cut circular patches on top of the rubber.
          diffuseColor.a*=fringe;
        #endif`)
        .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
          vec3 snowSurface=normalize(cross(snowDx,snowDy));
          normal=normalize(mix(normal,snowSurface,.65));
          vec3 snowRx=cross(snowDy,normal),snowRy=cross(normal,snowDx);
          float snowDet=dot(snowDx,snowRx);
          normal=normalize(normal-sign(snowDet)*(snowSlope.x*snowRx+snowSlope.y*snowRy)/max(abs(snowDet),.000001));`);
    };
    this.frostMaterial.customProgramCacheKey=()=> 'wheel-snow-model-locked-mantle-v2';
    this.frostGeometry=createFrostGeometry(this.depth);this.frostMesh=new THREE.Mesh(this.frostGeometry,this.frostMaterial);
    this.frostMesh.name='Continuous irregular snow mantle';this.frostMesh.receiveShadow=true;this.frostMesh.frustumCulled=false;this.group.add(this.frostMesh);
    // Retain convenient aliases without retaining the old visible mound pool.
    this.material=this.frostMaterial;this.geometry=this.frostGeometry;this.mesh=this.frostMesh;
  }

  updateFrostTexture(){
    this.filmSums.fill(0);
    for(let i=0;i<COUNT;i++)for(let corner=0;corner<4;corner++){
      const index=this.filmIndices[i*4+corner],weight=this.filmWeights[i*4+corner];
      this.filmSums[index]+=this.heights[i]*weight;
    }
    let changed=this.frostMap.version===0;
    for(let i=0;i<COUNT;i++){
      const mass=this.filmTotals[i]>0?this.filmSums[i]/this.filmTotals[i]:0;
      const k=i*4;
      const load=Math.round(clamp(mass/.3,0,1)*255),coverage=Math.round(clamp(mass/.035,0,1)*255);
      if(load!==this.filmPixels[k]||coverage!==this.filmPixels[k+1])changed=true;
      this.filmPixels[k]=load;
      this.filmPixels[k+1]=coverage;
    }
    if(changed)this.frostMap.needsUpdate=true;
  }

  prepareWorld(){
    this.wheelSpin.updateWorldMatrix(true,false);
    this.normalMatrix.getNormalMatrix(this.wheelSpin.matrixWorld);
    this.center.setFromMatrixPosition(this.wheelSpin.matrixWorld);
    this.axis.set(0,0,1).transformDirection(this.wheelSpin.matrixWorld);
  }

  reset({empty=false}={}){
    this.heights.fill(0);this.pendingVolume.fill(0);this._shedCount=0;this.shedCursor=0;this.previousAngle=this.wheelSpin.rotation.z;
    this.prepareWorld();const max=read(this.settings,'accumulationMax',.12,0,.3);
    if(!empty&&this.settings.accumulationEnabled!==false&&read(this.settings,'snowfall',6,0,12)>0){
      for(let i=0;i<COUNT;i++){
        this.worldNormal.fromArray(this.normals,i*3).applyNormalMatrix(this.normalMatrix);
        const upward=clamp((this.worldNormal.y-.22)/.78,0,1);
        this.heights[i]=Math.min(max,.012+noise(i+211)*.023)*upward*(.55+noise(i+227)*.45);
      }
    }
    this.writeMatrices();
  }

  writeMatrices(){
    this.updateFrostTexture();
    this.group.visible=this.settings.accumulationEnabled!==false&&read(this.settings,'accumulationMax',.12,0,.3)>0;
  }

  queueShed(i,height,omega){
    if(typeof this.onShed!=='function'||height<=0)return;
    const k=i*3,volume=height*this.areas[i],previous=this.pendingVolume[i],total=previous+volume;
    this.worldPosition.fromArray(this.anchors,k).addScaledVector(this.localNormal,visibleHeight(this.heights[i]+height*.5)).applyMatrix4(this.wheelSpin.matrixWorld);
    this.radial.copy(this.worldPosition).sub(this.center);this.radial.addScaledVector(this.axis,-this.radial.dot(this.axis));
    this.velocity.crossVectors(this.axis,this.radial).multiplyScalar(omega).addScaledVector(this.worldNormal,.12+noise(i+293)*.3);this.velocity.y-=.12+noise(i+317)*.25;
    // Queue a bounded amount per patch if several patches release in one frame.
    for(let c=0;c<3;c++){
      const position=c===0?this.worldPosition.x:c===1?this.worldPosition.y:this.worldPosition.z;
      const velocity=c===0?this.velocity.x:c===1?this.velocity.y:this.velocity.z;
      this.pendingPosition[k+c]=(this.pendingPosition[k+c]*previous+position*volume)/total;
      this.pendingVelocity[k+c]=(this.pendingVelocity[k+c]*previous+velocity*volume)/total;
    }
    this.pendingVolume[i]=total;
  }

  flushShed(){
    if(typeof this.onShed!=='function'){this.pendingVolume.fill(0);return;}
    let callbacks=0;
    for(let examined=0;examined<COUNT&&callbacks+3<=MAX_SHED_CALLBACKS;examined++){
      const i=this.shedCursor;this.shedCursor=(this.shedCursor+1)%COUNT;
      const volume=this.pendingVolume[i];if(volume<=0||(volume<this.areas[i]*.003&&this.heights[i]>.0003))continue;
      const k=i*3;
      // Two irregular crumbs and a finer powder portion carry the lost mass.
      for(let part=0;part<3;part++){
        this.callbackPosition.fromArray(this.pendingPosition,k);this.callbackVelocity.fromArray(this.pendingVelocity,k);
        const jitter=noise(i*3+part+this._shedCount*.13);
        this.callbackVelocity.x+=(jitter-.5)*.65;this.callbackVelocity.y+=part===2?.16:-.04;this.callbackVelocity.z+=(noise(i+part*97)-.5)*.65;
        const kind=part===2?'powder':part===1?'chip':jitter>.80?'clump':'chip';
        const diameter=Math.min(.045,Math.cbrt(volume*[.42,.36,.22][part])*(part===2?.45:kind==='clump'?1:.75));
        this.onShed({position:this.callbackPosition,velocity:this.callbackVelocity,size:diameter,kind});
        callbacks++;this._shedCount++;
      }
      this.pendingVolume[i]=0;
    }
  }

  update(dt,{rpm=0,time=0,settings=this.settings}={}){
    if(this.disposed)return;this.settings=settings??this.settings;
    dt=Number.isFinite(dt)?clamp(dt,0,.04):0;rpm=Number.isFinite(rpm)?rpm:0;
    if(read(this.settings,'treadDepth',.055,.001,.2)!==this.depth)this.rebuildAnchors();
    this.material.color.set(this.settings.snowColor??'#e7ebf2');this.prepareWorld();
    const angle=this.wheelSpin.rotation.z,delta=THREE.MathUtils.euclideanModulo(angle-this.previousAngle+Math.PI,TAU)-Math.PI;
    const omega=dt>0&&Math.abs(delta)>1e-7?delta/dt:-rpm/60*TAU;this.previousAngle=angle;
    const max=read(this.settings,'accumulationMax',.12,0,.3),enabled=this.settings.accumulationEnabled!==false;
    const snowfall=read(this.settings,'snowfall',6,0,12),rate=read(this.settings,'accumulationRate',1,0,5);
    const adhesion=read(this.settings,'snowAdhesion',.65,0,1),shedding=read(this.settings,'snowShedding',1,0,5);
    if(enabled)for(let i=0;i<COUNT;i++){
      const k=i*3;this.localNormal.fromArray(this.normals,k);this.worldNormal.copy(this.localNormal).applyNormalMatrix(this.normalMatrix);
      const upward=clamp((this.worldNormal.y-.12)/.88,0,1);
      const deposit=dt*.008*rate*clamp(snowfall/6,0,2)*Math.pow(upward,1.4)/(1+omega*omega*.13)*(.72+noise(i+401)*.56);
      const settled=Math.min(max,this.heights[i]+deposit);let height=settled;
      this.worldPosition.fromArray(this.anchors,k).applyMatrix4(this.wheelSpin.matrixWorld);
      this.radial.copy(this.worldPosition).sub(this.center);this.radial.addScaledVector(this.axis,-this.radial.dot(this.axis));
      const centrifugal=omega*omega*this.radial.length()/9.81;
      const gravityExcess=Math.max(0,.1-this.worldNormal.y-(.12+adhesion*.75));
      const centrifugalExcess=Math.max(0,centrifugal-(.4+adhesion*6));
      const loss=height*(1-Math.exp(-dt*shedding*(gravityExcess*2.8+centrifugalExcess*.35)));
      height-=loss;if(loss>0&&height<.00012)height=0;
      const lost=settled-height;
      this.heights[i]=height;
      // Excess snowfall above the holding limit simply never settles.
      this.queueShed(i,lost,omega);
    }
    if(enabled)this.flushShed();this.writeMatrices();
  }

  get coverage(){let sum=0;for(const height of this.heights)sum+=clamp(height/.018,0,1);return sum/COUNT;}
  get mass(){let sum=0;for(let i=0;i<COUNT;i++)sum+=this.heights[i]*this.areas[i];return sum;}
  get shedCount(){return this._shedCount;}

  dispose(){
    if(this.disposed)return;this.disposed=true;this.group.removeFromParent();
    this.frostGeometry.dispose();this.frostMaterial.dispose();this.frostMap.dispose();this.group.clear();
    this.heights.fill(0);this.pendingVolume.fill(0);
  }
}
