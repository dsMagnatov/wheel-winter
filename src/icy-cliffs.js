import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const clamp=THREE.MathUtils.clamp;
const hash=(x,y,z=0)=>{const n=Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453123;return n-Math.floor(n);};
function noise(x,y,z){const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);let a=x-ix,b=y-iy,c=z-iz;a=a*a*(3-2*a);b=b*b*(3-2*b);c=c*c*(3-2*c);const lerp=THREE.MathUtils.lerp;return lerp(lerp(lerp(hash(ix,iy,iz),hash(ix+1,iy,iz),a),lerp(hash(ix,iy+1,iz),hash(ix+1,iy+1,iz),a),b),lerp(lerp(hash(ix,iy,iz+1),hash(ix+1,iy,iz+1),a),lerp(hash(ix,iy+1,iz+1),hash(ix+1,iy+1,iz+1),a),b),c);}
function fbm(x,y,z){let sum=0,weight=.5;for(let i=0;i<5;i++){sum+=noise(x,y,z)*weight;x=x*2.07+2.3;y=y*2.07+7.1;z=z*2.07+3.8;weight*=.5;}return sum;}

const ROCK_GLSL=`
float cliffHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float cliffNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(cliffHash(i),cliffHash(i+vec3(1,0,0)),f.x),mix(cliffHash(i+vec3(0,1,0)),cliffHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(cliffHash(i+vec3(0,0,1)),cliffHash(i+vec3(1,0,1)),f.x),mix(cliffHash(i+vec3(0,1,1)),cliffHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float cliffFbm(vec3 p){float n=0.;float a=.5;for(int i=0;i<5;i++){n+=cliffNoise(p)*a;p=p*2.03+vec3(2.3,7.1,3.8);a*=.5;}return n;}
vec3 cliffTriplanar(sampler2D tex,vec3 p,vec3 n){vec3 w=pow(abs(n),vec3(5.));w/=max(w.x+w.y+w.z,.0001);return texture2D(tex,p.yz).rgb*w.x+texture2D(tex,p.xz).rgb*w.y+texture2D(tex,p.xy).rgb*w.z;}
`;

function subdivide(input,levels){
  let geometry=mergeVertices(input);
  const source=geometry.attributes.position;
  const vertices=Array.from(source.array);
  let indices=Array.from(geometry.index.array);
  for(let level=0;level<levels;level++){
    const cache=new Map(),next=[];
    const midpoint=(a,b)=>{
      const key=a<b?`${a}:${b}`:`${b}:${a}`;
      if(cache.has(key))return cache.get(key);
      const index=vertices.length/3;for(let k=0;k<3;k++)vertices.push((vertices[a*3+k]+vertices[b*3+k])*.5);cache.set(key,index);return index;
    };
    for(let i=0;i<indices.length;i+=3){const a=indices[i],b=indices[i+1],c=indices[i+2],ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);next.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);}indices=next;
  }
  geometry.dispose();
  geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);return geometry;
}

function displaceCliffPoint(x,y,z,seed,amplitude,protectContact){
  const strata=fbm(x*.85+seed,y*.62,z*1.25)-.5;
  const layer=Math.sin(y*3.4+x*.68+fbm(x*.4,y*.4,z*.4)*2.4);
  const fissure=Math.pow(1-Math.abs(layer),9);
  const broad=fbm(x*.46+seed,y*.52,z*.44)-.5;
  const protection=protectContact?1-Math.exp(-((x-1.12)**2+(y+1.16)**2+(z-.55)**2)/.26):1;
  const a=amplitude*protection;
  return [x+(fbm(x*1.5+seed,y*.68,z*1.2)-.5)*a*.42,y+(fbm(x*.65,y*2.1+seed,z*.7)-.5)*a*.23,z+strata*a*2.7+broad*a*.9-fissure*a*.35];
}

function cliffGeometry(outline,{depth=3,front=1.1,seed=0,detail=4,amplitude=.75,protectContact=false}={}){
  const shape=new THREE.Shape();shape.moveTo(...outline[0]);for(const point of outline.slice(1))shape.lineTo(...point);shape.closePath();
  const prism=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelThickness:.04,bevelSize:.03,bevelSegments:1,curveSegments:1,steps:1});prism.translate(0,0,front-depth);
  const geometry=subdivide(prism,detail);prism.dispose();const p=geometry.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    p.setXYZ(i,...displaceCliffPoint(x,y,z,seed,amplitude,protectContact));
  }
  geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry;
}

function pathHeight(path,x){
  let i=0;while(i<path.length-2&&x>path[i+1][0])i++;
  const [a,b]=[path[i],path[i+1]],t=clamp((x-a[0])/(b[0]-a[0]),0,1);
  return THREE.MathUtils.lerp(a[1],b[1],t);
}

function snowLedgeGeometry(path,{back=-2.1,front=1.2,contact=false,seed=7,amplitude=.75}={}){
  const columns=144,rows=28,vertices=[],uvs=[],indices=[];
  const min=path[0][0],max=path.at(-1)[0];
  for(let i=0;i<=columns;i++)for(let j=0;j<=rows;j++){
    const x=THREE.MathUtils.lerp(min,max,i/columns);
    const edgeNoise=(fbm(x*3.1,0,seed)-.5)*.42+Math.sin(x*9.4)*.045;
    const z=THREE.MathUtils.lerp(back,front+edgeNoise,j/rows);
    const anchor=contact?1-Math.exp(-((x-1.12)**2+(z-.55)**2)/.16):1;
    const y=pathHeight(path,x);
    const p=displaceCliffPoint(x,y,z,seed,amplitude,contact);
    p[1]+=.06+(fbm(x*2.2,0,z*2.2)-.5)*.04*anchor;
    vertices.push(...p);uvs.push(i/columns,j/rows);
    if(i<columns&&j<rows){const a=i*(rows+1)+j,b=a+rows+1;indices.push(a,a+1,b,b,a+1,b+1);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

function boulderGeometry(){
  const geometry=new THREE.SphereGeometry(1,160,96),p=geometry.attributes.position;
  const center=new THREE.Vector3(3,-5,-.2),radii=new THREE.Vector3(4.5,4.35,3.1);
  for(let i=0;i<p.count;i++){
    const x=center.x+p.getX(i)*radii.x,y=center.y+p.getY(i)*radii.y,z=center.z+p.getZ(i)*radii.z;
    const normal=new THREE.Vector3((x-center.x)/(radii.x*radii.x),(y-center.y)/(radii.y*radii.y),(z-center.z)/(radii.z*radii.z)).normalize();
    const protect=1-Math.exp(-((x-1.12)**2+(y+1.18)**2+(z-.55)**2)/.38);
    const broad=(fbm(x*.55+19,y*.48,z*.6)-.5)*.66;
    const medium=(fbm(x*2.3,y*1.7,z*2.1)-.5)*.2;
    const fold=Math.sin(y*2.2+x*.24+fbm(x*.5,y*.5,z*.5)*2.);
    const groove=Math.pow(1-Math.abs(fold),10)*.13;
    const offset=(broad+medium-groove)*protect;
    p.setXYZ(i,x+normal.x*offset,y+normal.y*offset,z+normal.z*offset);
  }
  geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry;
}

function boulderSnowGeometry(source){
  const geometry=source.clone(),p=geometry.attributes.position,n=geometry.attributes.normal;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const offset=.025+Math.max(0,fbm(x*3.2,y*.7,z*3.2)-.48)*.035;
    p.setXYZ(i,x+n.getX(i)*offset,y+n.getY(i)*offset,z+n.getZ(i)*offset);
  }
  geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry;
}

/** Foreground cliff composition in XY; the wheel and camera remain external. */
export function createIcyCliffs({settings,uniforms={}}){
  const group=new THREE.Group();group.name='Icy cliff composition';
  const foreground=new THREE.Group();foreground.name='Foreground rock pair';group.add(foreground);
  const leftCliff=new THREE.Group(),rightCliff=new THREE.Group();
  foreground.add(leftCliff,rightCliff);
  const contactPoint=new THREE.Vector3(1.12,-1.1,.55),contactNormal=new THREE.Vector3(-.64,.768,0).normalize();
  const shared={
    uCliffTime:uniforms.uTime||{value:0},
    uCliffWind:uniforms.uWindSpeed||{value:1.2},
    uCliffVeil:uniforms.uVeil||{value:.42},
    uCliffVeilScale:uniforms.uVeilScale||{value:.6},
    uCliffWindDirection:uniforms.uWind||{value:new THREE.Vector2(1,0)},
    uCliffSnow:{value:new THREE.Color(settings.snowColor||'#e7ebf2')},
    uCliffGrain:{value:settings.snowGrain??.012},
    uCliffScale:{value:settings.snowScale??46},
    uCliffRelief:{value:settings.snowRelief??.4},
    uCliffCover:{value:clamp(settings.snowCover??.75,0,2)},
    uCliffSparkle:{value:clamp(settings.snowSparkle??.3,0,5)},
    uCliffTexture:{value:new THREE.Texture()},uCliffHasTexture:{value:0},
    uRockTint:{value:new THREE.Color()},uRockBump:{value:0},uRockTextureScale:{value:1},uRockIce:{value:0},
    uCliffBaseY:{value:0},
  };
  function makeMaterial({cap=false,distant=false}={}){
    const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:cap?.9:.84,metalness:cap?0:.04,envMapIntensity:.1,side:THREE.DoubleSide,transparent:cap,depthWrite:!cap});
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,shared);shader.uniforms.uCliffCap={value:cap?1:0};shader.uniforms.uCliffDistant={value:distant?1:0};
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vCliffWorld;varying vec3 vCliffSurface;varying vec3 vCliffNormal;uniform float uCliffBaseY;').replace('#include <begin_vertex>','#include <begin_vertex>\nvCliffWorld=(modelMatrix*vec4(transformed,1.)).xyz;vCliffSurface=mat3(modelMatrix)*transformed+vec3(0.,uCliffBaseY,0.);vCliffNormal=normalize(mat3(modelMatrix)*objectNormal);');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 vCliffWorld;varying vec3 vCliffSurface;varying vec3 vCliffNormal;uniform sampler2D uCliffTexture;uniform float uCliffHasTexture;uniform vec3 uCliffSnow;uniform float uCliffGrain;uniform float uCliffScale;uniform float uCliffRelief;uniform float uCliffCover;uniform float uCliffSparkle;uniform float uCliffTime;uniform float uCliffWind;uniform float uCliffVeil;uniform float uCliffVeilScale;uniform vec2 uCliffWindDirection;uniform float uCliffCap;uniform float uCliffDistant;uniform vec3 uRockTint;uniform float uRockBump;uniform float uRockTextureScale;uniform float uRockIce;${ROCK_GLSL}`)
        .replace('#include <color_fragment>',`#include <color_fragment>
          vec3 rockP=vCliffSurface;
          vec3 rockN=normalize(vCliffNormal);
          float broad=cliffFbm(rockP*1.7);
          float fine=cliffNoise(rockP*11.);
          float folded=cliffFbm(vec3(rockP.x*2.,rockP.y*7.+rockP.x*1.6,rockP.z*2.));
          float crack=smoothstep(.66,.82,cliffNoise(rockP*vec3(.7,2.3,.8)))*.18;
          vec3 rockColor=mix(vec3(.004,.011,.018),vec3(.025,.048,.067),broad*.8+fine*.2);
          vec3 texColor=cliffTriplanar(uCliffTexture,rockP*(.31*uRockTextureScale),rockN);
          rockColor=mix(rockColor,texColor*.28,uCliffHasTexture);
          rockColor*=1.-crack*.65;
          float icy=smoothstep(.63,.83,folded)*uRockIce;
          rockColor=mix(rockColor,vec3(.035,.095,.13),icy);
          rockColor*=uRockTint;
          float snowSpread=max(0.,uCliffCover-.75)*.3;
          float deposit=smoothstep(.82-snowSpread,.98-snowSpread,rockN.y+(broad-.5)*.12)*.65;
          float streak=smoothstep(.76,.9,cliffFbm(vec3(rockP.x*2.3,rockP.y*.4+rockP.x*.15,rockP.z*1.8)))*.09;
          deposit=clamp((deposit+streak+uCliffRelief*.015)*(uCliffCover/.75),0.,1.);
          deposit=mix(deposit,1.,uCliffCap);
          vec3 snowCol=uCliffSnow*(.56+fine*.1);
          vec3 finalCliff=mix(rockColor,snowCol,deposit);
          vec2 veilUv=vec2(vCliffWorld.x+vCliffWorld.z*.28,vCliffWorld.y)*vec2(.55,3.4)*uCliffVeilScale;
          veilUv-=uCliffWindDirection*uCliffTime*uCliffWind*.12;
          float surfaceVeil=smoothstep(.53,.8,cliffFbm(vec3(veilUv,vCliffWorld.z*.11)))*uCliffVeil*.28;
          finalCliff=mix(finalCliff,uCliffSnow*.55,clamp(surfaceVeil,0.,.6));
          finalCliff=mix(finalCliff,vec3(.26,.37,.47),uCliffDistant*.45);
          diffuseColor.rgb*=finalCliff;
          float crystal=pow(cliffNoise(rockP*145.),18.);
          float crystalLight=.65+.35*sin(uCliffTime*.65+dot(rockP,vec3(9.,13.,7.)));
          diffuseColor.rgb+=uCliffSnow*crystal*crystalLight*uCliffSparkle*.45*deposit;
          if(uCliffCap>.5){
            float snowPatch=cliffFbm(rockP*vec3(10.,3.,10.));
            float patchShift=(uCliffCover-.75)*.18;
            diffuseColor.a*=smoothstep(.38-patchShift,.65-patchShift,snowPatch)*smoothstep(.45-snowSpread,.92-snowSpread,rockN.y)*min(uCliffCover/.75,1.);
          }
        `)
        .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
          vec3 np=vCliffSurface;
          float detailHeight=cliffNoise(np*vec3(4.,14.,5.))*(uRockBump*.1)*(1.-uCliffCap)+cliffNoise(np*(uCliffScale*.3))*uCliffGrain*.3;
          vec3 q0=dFdx(-vViewPosition),q1=dFdy(-vViewPosition);vec3 r1=cross(q1,normal),r2=cross(normal,q0);
          float det=dot(q0,r1);vec3 grad=sign(det)*(dFdx(detailHeight)*r1+dFdy(detailHeight)*r2);
          normal=normalize(abs(det)*normal-grad);
        `);
    };
    material.customProgramCacheKey=()=>`icy-cliff-${cap}-${distant}`;return material;
  }
  const rockMaterial=makeMaterial(),snowMaterial=makeMaterial({cap:true});
  const leftOutline=[[-8,7],[-5.5,5.2],[-3.45,3.25],[-2.25,1.95],[-1.4,1.04],[-1.26,.55],[-1.65,.1],[-3.3,-.3],[-5.4,-.3],[-8,-.4]];
  const left=new THREE.Mesh(cliffGeometry(leftOutline,{depth:4.6,front:.45,seed:7,amplitude:.75}),rockMaterial);left.name='Left diagonal ice cliff';left.castShadow=true;left.receiveShadow=true;
  const leftSnowPath=[[-8,7],[-5.5,5.2],[-3.45,3.25],[-2.25,1.95],[-1.4,1.04]];
  const leftSnow=new THREE.Mesh(snowLedgeGeometry(leftSnowPath,{back:-2.7,front:.44,seed:7,amplitude:.75}),snowMaterial);leftSnow.name='Snow retained on left ridge';leftSnow.receiveShadow=true;
  leftCliff.add(left,leftSnow);
  const seatSource=new THREE.Vector3(-1.37855649,1.00859487,.68576926),seatDelta=new THREE.Vector3(.55,-.06,.44);
  for(const mesh of [left,leftSnow]){
    const positions=mesh.geometry.attributes.position;
    for(let i=0;i<positions.count;i++){
      const point=new THREE.Vector3().fromBufferAttribute(positions,i);
      const weight=1-THREE.MathUtils.smoothstep(point.distanceTo(seatSource),0,.9);
      point.addScaledVector(seatDelta,weight);positions.setXYZ(i,point.x,point.y,point.z);
    }
    positions.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere();mesh.geometry.computeBoundingBox();
  }
  const seatLocal=seatSource.clone().add(seatDelta);
  let seatIndex=0,seatDistance=Infinity;const seatPositions=left.geometry.attributes.position;
  for(let i=0;i<seatPositions.count;i++){const d=new THREE.Vector3().fromBufferAttribute(seatPositions,i).distanceToSquared(seatLocal);if(d<seatDistance){seatDistance=d;seatIndex=i;}}
  const seatLocalNormal=new THREE.Vector3().fromBufferAttribute(left.geometry.attributes.normal,seatIndex).normalize();
  const rightGeometry=boulderGeometry();
  const right=new THREE.Mesh(rightGeometry,rockMaterial);right.name='Right rounded contact boulder';right.castShadow=true;right.receiveShadow=true;
  const rightSnow=new THREE.Mesh(boulderSnowGeometry(rightGeometry),snowMaterial);rightSnow.name='Snow retained on curved boulder';rightSnow.receiveShadow=true;
  rightCliff.add(right,rightSnow);
  // The authored caps represent 25 mm of snow. Keep an immutable reference so
  // changing the depth never offsets an already-displaced surface again.
  const snowDepthLayers=[leftSnow,rightSnow].map(mesh=>{
    const geometry=mesh.geometry,positions=geometry.attributes.position;
    const normals=geometry.attributes.normal.array.slice(),base=positions.array.slice();
    for(let i=0;i<base.length;i++)base[i]-=normals[i]*.025;
    return {geometry,positions,normals,base};
  });
  let appliedSnowDepth=.025,accumulationDepth=0,accumulationRevision=0;
  function applySnowDepth(){
    const depth=clamp(settings.snowDepth??.025,0,.2)+accumulationDepth;
    shared.uCliffCover.value=clamp((settings.snowCover??.75)+accumulationDepth*.8,0,2);
    if(depth===appliedSnowDepth)return;
    for(const {geometry,positions,normals,base} of snowDepthLayers){
      for(let i=0;i<base.length;i++)positions.array[i]=base[i]+normals[i]*depth;
      positions.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.computeBoundingBox();
    }
    appliedSnowDepth=depth;accumulationRevision++;
  }
  function setAccumulation(depth=0){
    // Two-millimetre steps keep weather growth from rebuilding both caps every frame.
    accumulationDepth=Math.round(clamp(Number.isFinite(depth)?depth:0,0,.3)/.002)*.002;
    applySnowDepth();return accumulationDepth;
  }
  const ready=new Promise((resolve,reject)=>new THREE.TextureLoader().load('/textures/ice-rock.png',texture=>{texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=8;shared.uCliffTexture.value=texture;shared.uCliffHasTexture.value=1;resolve();},undefined,reject));
  function update(next=settings){
    settings=next;
    const tint=shared.uRockTint.value.set(next.rockColor);
    const luminance=.2126*tint.r+.7152*tint.g+.0722*tint.b;
    tint.multiplyScalar(.8/Math.max(.1,luminance)).addScalar(.2);
    shared.uRockBump.value=next.rockBump;
    shared.uRockTextureScale.value=next.rockTextureScale;
    shared.uRockIce.value=next.rockIce;
    rockMaterial.roughness=next.rockRoughness;
    shared.uCliffSnow.value.set(next.snowColor||'#e7ebf2');shared.uCliffGrain.value=next.snowGrain??.012;shared.uCliffScale.value=next.snowScale??46;shared.uCliffRelief.value=next.snowRelief??.4;
    shared.uCliffCover.value=clamp(next.snowCover??.75,0,2);shared.uCliffSparkle.value=clamp(next.snowSparkle??.3,0,5);
    snowMaterial.roughness=next.snowRoughness??.88;
    applySnowDepth();
    const vertical=.85+.15*clamp(next.hillHeight??1,.1,4);foreground.scale.y=vertical;foreground.position.y=contactPoint.y*(1-vertical);
    shared.uCliffBaseY.value=foreground.position.y;
  }
  function setSeparation(amount){
    const travel=clamp(amount,0,1);
    leftCliff.position.set(-7.2*travel,.42*travel,-.9*travel);
    rightCliff.position.set(7.5*travel,-.68*travel,-.62*travel);
  }
  function setSnowTexture(slot,texture){if(!['map','bumpMap','roughnessMap'].includes(slot))return;for(const mat of [snowMaterial]){mat[slot]=texture;mat.needsUpdate=true;}}
  update(settings);
  const raycaster=new THREE.Raycaster();
  const snowSurfaces=[leftSnow,rightSnow,left,right],surfaceDown=new THREE.Vector3(0,-1,0);
  function querySnowSurface(x,z){
    if(!Number.isFinite(x)||!Number.isFinite(z))return null;
    group.updateMatrixWorld(true);raycaster.set(new THREE.Vector3(x,30,z),surfaceDown);
    const hit=raycaster.intersectObjects(snowSurfaces,false)[0];
    if(!hit)return null;
    const normal=hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();if(normal.y<0)normal.negate();
    return {point:hit.point.clone(),normal};
  }
  function queryContact(offsetX=0,offsetZ=0){
    const point=contactPoint.clone().add(rightCliff.position);
    point.y=contactPoint.y+rightCliff.position.y*foreground.scale.y;
    group.updateMatrixWorld(true);raycaster.set(new THREE.Vector3(point.x+offsetX,point.y+6,point.z+offsetZ),surfaceDown);
    const hit=raycaster.intersectObject(rightSnow,false)[0];
    if(!hit)return {point,normal:contactNormal.clone()};
    const normal=hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(rightSnow.matrixWorld)).normalize();if(normal.y<0)normal.negate();
    return {point:hit.point.clone(),normal};
  }
  function queryLeftSeat(){leftCliff.updateWorldMatrix(true,false);return {point:seatLocal.clone().applyMatrix4(leftCliff.matrixWorld),normal:seatLocalNormal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(leftCliff.matrixWorld)).normalize()};}
  return {group,update,ready,contactPoint,contactNormal,queryContact,queryLeftSeat,querySnowSurface,setAccumulation,setSeparation,
    get accumulationRevision(){return accumulationRevision;},get accumulationDepth(){return accumulationDepth;},
    rockMaterials:[rockMaterial],snowMaterials:[snowMaterial],setSnowTexture};
}
