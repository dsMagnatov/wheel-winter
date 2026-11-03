import * as THREE from 'three';

const TAU = Math.PI * 2;
const treadSegments = 1008, treadAcross = 96, treadWidth = 0.86;
const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x-a)/(b-a), 0, 1); return t*t*(3-2*t); };

export function crownRadius(z) {
  return 1.507 - 0.095 * (Math.abs(z) / 0.43) ** 4;
}

// One watertight crown, rather than raised blocks suspended above the casing.
// Grooves descend into the continuous rubber surface; shoulders meet the sidewall.
export function createWinterTread(depth) {
  const segments = treadSegments, across = treadAcross, width = treadWidth;
  const positions = [], uvs = [], indices = [];
  for (let i=0; i<=segments; i++) {
    const angle = i/segments*TAU;
    for (let j=0; j<=across; j++) {
      const z = (j/across-0.5)*width;
      const shoulder = 1-smooth(0.35,0.43,Math.abs(z));
      // Directional chevrons feed into three narrow, zigzag drainage channels.
      const phase = ((i/segments*56 + Math.abs(z)*3.5) % 1 + 1) % 1;
      const transverse = smooth(0.055,0.11,phase)*(1-smooth(0.87,0.93,phase));
      let longitudinal = 1;
      for (const channel of [-0.245,0,0.245]) {
        const zig = channel + Math.sin(angle*56)*0.007;
        longitudinal = Math.min(longitudinal,smooth(0.009,0.023,Math.abs(z-zig)));
      }
      const block = Math.min(transverse,longitudinal);
      const radius = crownRadius(z) + depth*shoulder*block;
      positions.push(Math.cos(angle)*radius,Math.sin(angle)*radius,z);
      uvs.push(i/segments,j/across);
      if(i<segments&&j<across){const a=i*(across+1)+j,b=a+across+1;indices.push(a,b,a+1,b,b+1,a+1);}
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  // Weld the angular seam normals without merging UV coordinates.
  const normals=geometry.attributes.normal;
  for(let j=0;j<=across;j++){
    const a=j,b=segments*(across+1)+j;
    const n=new THREE.Vector3().fromBufferAttribute(normals,a).add(new THREE.Vector3().fromBufferAttribute(normals,b)).normalize();
    normals.setXYZ(a,n.x,n.y,n.z);normals.setXYZ(b,n.x,n.y,n.z);
  }
  geometry.computeBoundingSphere();return geometry;
}

// Each angular row fits between its outer tread radius and the axial ends.
// Skip rows whose best possible dot product cannot beat the current contact.
export function findTreadSupport(geometry, depth, normal, support) {
  const positions = geometry.attributes.position.array;
  const rowSize = (treadAcross + 1) * 3;
  const nx = normal.x, ny = normal.y, nz = normal.z;
  const radialBound = crownRadius(0) + depth;
  const axialBound = Math.abs(nz) * treadWidth / 2;
  const angle = (Math.atan2(-ny, -nx) + TAU) % TAU;
  const seed = Math.round(angle / TAU * treadSegments) * rowSize;
  let minimum = Infinity, best = seed;
  for (let i = seed; i < seed + rowSize; i += 3) {
    const dot = positions[i] * nx + positions[i + 1] * ny + positions[i + 2] * nz;
    if (dot < minimum) { minimum = dot; best = i; }
  }
  for (let row = 0; row < positions.length; row += rowSize) {
    const theta = row / rowSize / treadSegments * TAU;
    const radial = nx * Math.cos(theta) + ny * Math.sin(theta);
    if (Math.min(0, radial) * radialBound - axialBound - 1e-6 > minimum || row === seed) continue;
    for (let i = row; i < row + rowSize; i += 3) {
      const dot = positions[i] * nx + positions[i + 1] * ny + positions[i + 2] * nz;
      if (dot < minimum || (dot === minimum && i < best)) { minimum = dot; best = i; }
    }
  }
  support.set(positions[best], positions[best + 1], positions[best + 2]);
  return minimum;
}

export function makeForgedSpokes(count, faceMaterial, edgeMaterial) {
  const group=new THREE.Group();
  const outline=[[-.052,.18],[.052,.18],[.075,.43],[.225,.925],[.173,.969],[.026,.605],[-.018,.59],[-.168,.969],[-.217,.93],[-.071,.43]];
  const shape=new THREE.Shape();shape.moveTo(...outline[0]);for(const p of outline.slice(1))shape.lineTo(...p);shape.closePath();
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:.085,bevelEnabled:true,bevelThickness:.014,bevelSize:.012,bevelSegments:3,curveSegments:8});
  const positions=geometry.attributes.position;
  for(let i=0;i<positions.count;i++){
    const y=positions.getY(i);const concave=.10*(2*THREE.MathUtils.clamp((y-.18)/.79,0,1)-1)**2;
    positions.setZ(i,positions.getZ(i)+.295+concave);
  }
  geometry.computeVertexNormals();
  for(let i=0;i<count;i++){
    const spoke=new THREE.Mesh(geometry,[faceMaterial,edgeMaterial]);spoke.rotation.z=i/count*TAU;spoke.castShadow=true;group.add(spoke);
    // Machined inset highlights run along the outer branches.
    for(const side of [-1,1]){
      const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(side*.048,.49,.395),new THREE.Vector3(side*.109,.73,.423),new THREE.Vector3(side*.177,.932,.49)]);
      const edge=new THREE.Mesh(new THREE.TubeGeometry(curve,12,.005,5,false),edgeMaterial);edge.rotation.z=i/count*TAU;group.add(edge);
    }
  }
  return group;
}
