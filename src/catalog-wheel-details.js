import * as THREE from 'three';

const spokeDesigns = {
  1: {
    count: 5,
    outline: [
      [-.11, .17], [.08, .17], [.19, .43], [.23, .66], [.30, .91],
      [.16, .94], [.09, .72], [.015, .54], [-.065, .39],
    ],
    bevel: .021,
  },
  2: {
    count: 8,
    outline: [
      [-.06, .18], [.065, .18], [.064, .42], [.035, .69], [.066, .94],
      [-.047, .96], [-.07, .74], [-.065, .48],
    ],
    bevel: .012,
  },
};

const springDesigns = [
  { color: 0xff5423, length: .67, turns: 5, radius: .105, wire: .024, taper: .08, lean: -.24 },
  { color: 0x66c9ee, length: .63, turns: 7, radius: .093, wire: .017, taper: 0, lean: .14 },
  { color: 0xe2b94c, length: .71, turns: 4.5, radius: .12, wire: .025, taper: .24, lean: -.08 },
];

function buildSpokes(design, faceMaterial, edgeMaterial) {
  const shape = new THREE.Shape();
  shape.moveTo(...design.outline[0]);
  for (const point of design.outline.slice(1)) shape.lineTo(...point);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: .078,
    bevelEnabled: true,
    bevelThickness: design.bevel,
    bevelSize: design.bevel,
    bevelSegments: 3,
  });
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const dish = .11 * THREE.MathUtils.smoothstep(positions.getY(i), .2, .95);
    positions.setZ(i, positions.getZ(i) + .304 + dish);
  }
  geometry.computeVertexNormals();

  const group = new THREE.Group();
  group.name = 'Catalog spokes';
  for (let i = 0; i < design.count; i++) {
    const spoke = new THREE.Mesh(geometry, [faceMaterial, edgeMaterial]);
    spoke.rotation.z = i / design.count * 2 * Math.PI;
    group.add(spoke);
  }
  return group;
}

function buildCoilover(design) {
  const springMaterial = new THREE.MeshStandardMaterial({
    color: design.color, roughness: .28, metalness: .52,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: 0x758599, roughness: .3, metalness: .84,
  });
  const collarMaterial = new THREE.MeshStandardMaterial({
    color: 0x343e4d, roughness: .36, metalness: .62,
  });
  const group = new THREE.Group();
  group.name = 'Catalog suspension coilover';
  group.position.set(-.57, .18, .273);
  group.rotation.z = design.lean;

  const points = [];
  const segments = Math.ceil(design.turns * 18);
  for (let i = 0; i <= segments; i++) {
    const progress = i / segments;
    const theta = progress * Math.PI * 2 * design.turns;
    const radius = design.radius * (1 - design.taper * Math.abs(progress * 2 - 1));
    points.push(new THREE.Vector3(
      radius * Math.cos(theta),
      (progress - .5) * design.length,
      radius * Math.sin(theta) * .72,
    ));
  }
  const path = new THREE.CatmullRomCurve3(points);
  const spring = new THREE.Mesh(
    new THREE.TubeGeometry(path, segments, design.wire, 8, false),
    springMaterial,
  );
  group.add(spring);

  const piston = new THREE.Mesh(
    new THREE.CylinderGeometry(.038, .044, design.length + .12, 14),
    steel,
  );
  group.add(piston);
  const collarGeometry = new THREE.CylinderGeometry(
    design.radius + .014, design.radius + .014, .056, 20,
  );
  collarGeometry.scale(1, 1, .65);
  for (const side of [-1, 1]) {
    const collar = new THREE.Mesh(collarGeometry, collarMaterial);
    collar.position.y = side * (design.length * .5 + .019);
    group.add(collar);
  }
  return { group, materials: [springMaterial, steel, collarMaterial] };
}

export function installCatalogWheelDetails(wheel, productIndex, rimMaterial, edgeMaterial) {
  const rim = wheel.getObjectByName('wheel-rim') ??
    wheel.children[0]?.children.find(child => child.isGroup && child.children.some(item => item.isGroup));
  const originalSpokes = rim?.getObjectByName('wheel-spokes') ??
    rim?.children.find(child => child.isGroup);
  const originalVisibility = originalSpokes?.visible;
  const design = spokeDesigns[productIndex];
  const customSpokes = rim && originalSpokes && design
    ? buildSpokes(design, rimMaterial, edgeMaterial)
    : null;
  if (customSpokes) {
    originalSpokes.visible = false;
    rim.add(customSpokes);
  }
  const coilover = buildCoilover(springDesigns[productIndex]);
  wheel.add(coilover.group);

  return () => {
    if (customSpokes) {
      originalSpokes.visible = originalVisibility;
      customSpokes.removeFromParent();
      customSpokes.children[0].geometry.dispose();
    }
    coilover.group.removeFromParent();
    const geometries = new Set(coilover.group.children.map(mesh => mesh.geometry));
    for (const geometry of geometries) geometry.dispose();
    for (const material of coilover.materials) material.dispose();
  };
}
