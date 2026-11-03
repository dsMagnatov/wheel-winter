import * as THREE from 'three';
import { installCatalogWheelDetails } from './catalog-wheel-details.js';

export const catalogCenter = new THREE.Vector3(0, 0.82, 0);
export const catalogRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.46, 0.58, -0.25));

const dwellSeconds = 2.6;
const slideSeconds = 0.93;
const wrap = (value, length) => THREE.MathUtils.euclideanModulo(value, length);

export class WheelCatalog {
  constructor(root, rimMaterial, rimEdgeMaterial, products, onSelect, onMoving = () => {}) {
    this.root = root;
    this.rimMaterial = rimMaterial;
    this.rimEdgeMaterial = rimEdgeMaterial;
    this.products = products;
    this.onSelect = onSelect;
    this.onMoving = onMoving;
    this.wheels = [root];
    this.variantMaterials = [];
    this.baseScale = new THREE.Vector3();
    this.rockingEuler = new THREE.Euler();
    this.rockingRotation = new THREE.Quaternion();
    this.inspectionEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.inspectionRotation = new THREE.Quaternion();
    this.dragging = false;
    this.paused = false;
    this.active = false;
  }

  prepareEntrance() {
    this.baseScale.copy(this.root.scale);
    this.createVariants();
    this.detailCleanups = this.wheels.slice(1).map((wheel, index) => {
      const [face, edge] = this.variantMaterials.slice(index * 2, index * 2 + 2);
      return installCatalogWheelDetails(wheel, index + 1, face, edge);
    });
    this.index = 0;
    this.phase = 0;
    this.direction = 0;
    this.pending = 0;
    this.elapsed = 0;
    this.motionTime = 0;
    this.lean = 0;
    this.inspectionEuler.set(0, 0, 0);
  }

  enter() {
    this.detailCleanups.push(installCatalogWheelDetails(this.root, 0, this.rimMaterial, this.rimEdgeMaterial));
    this.active = true;
    this.onSelect(0);
    this.onMoving(false);
  }

  createVariants() {
    for (const product of this.products.slice(1)) {
      const variant = this.root.clone();
      const face = this.rimMaterial.clone();
      const edge = this.rimEdgeMaterial.clone();
      face.color.setHex(product.rimColor);
      edge.color.copy(face.color).lerp(new THREE.Color(0xffffff), 0.44);
      this.variantMaterials.push(face, edge);
      variant.traverse(object => {
        if (!object.isMesh) return;
        const replace = material => {
          if (material === this.rimMaterial) return face;
          if (material === this.rimEdgeMaterial) return edge;
          return material;
        };
        object.material = Array.isArray(object.material) ? object.material.map(replace) : replace(object.material);
      });
      variant.visible = false;
      this.root.parent.add(variant);
      this.wheels.push(variant);
    }
  }

  leave() {
    if (!this.active) return;
    this.active = false;
    this.endDrag();
    for (const cleanup of this.detailCleanups) cleanup();
    this.detailCleanups.length = 0;
    for (const wheel of this.wheels.slice(1)) wheel.removeFromParent();
    for (const material of this.variantMaterials) material.dispose();
    this.wheels.length = 1;
    this.variantMaterials.length = 0;
    this.root.visible = true;
    this.onMoving(false);
  }

  setPaused(paused) {
    this.paused = paused;
    if (!this.direction) this.elapsed = 0;
  }

  beginDrag() {
    if (!this.active || this.direction || this.dragging) return false;
    this.dragging = true;
    this.elapsed = 0;
    return true;
  }

  dragBy(dx, dy) {
    if (!this.dragging) return;
    this.inspectionEuler.y = wrap(this.inspectionEuler.y + dx * .009 + Math.PI, Math.PI * 2) - Math.PI;
    this.inspectionEuler.x = THREE.MathUtils.clamp(this.inspectionEuler.x + dy * .009, -1.1, 1.1);
  }

  endDrag() {
    this.dragging = false;
    if (!this.direction) this.elapsed = 0;
  }

  move(step) {
    if (!this.active || !step || this.dragging) return;
    if (this.direction) {
      this.pending = Math.sign(step);
      return;
    }
    this.direction = Math.sign(step);
    this.elapsed = 0;
    this.onMoving(true);
  }

  update(dt, camera, reducedMotion) {
    if (!this.active) return;
    this.motionTime += dt;
    let travelLean = 0;
    if (this.direction) {
      this.elapsed += dt;
      const progress = reducedMotion ? 1 : Math.min(1, this.elapsed / slideSeconds);
      this.phase = this.index + this.direction * THREE.MathUtils.smoothstep(progress, 0, 1);
      travelLean = this.direction * Math.sin(Math.PI * progress);
      this.inspectionEuler.x = THREE.MathUtils.damp(this.inspectionEuler.x, 0, 8, dt);
      this.inspectionEuler.y = THREE.MathUtils.damp(this.inspectionEuler.y, 0, 8, dt);
      if (progress === 1) {
        this.inspectionEuler.set(0, 0, 0);
        this.index = wrap(this.index + this.direction, this.wheels.length);
        this.phase = this.index;
        this.direction = 0;
        this.elapsed = 0;
        this.onSelect(this.index);
        this.onMoving(false);
        const next = this.pending;
        this.pending = 0;
        if (next) this.move(next);
      }
    } else if (!this.paused && !this.dragging && !reducedMotion) {
      this.elapsed += dt;
      if (this.elapsed >= dwellSeconds) this.move(1);
    }
    this.lean = reducedMotion ? 0 : THREE.MathUtils.damp(this.lean, travelLean, 8, dt);
    this.layout(camera, reducedMotion);
  }

  layout(camera, reducedMotion, entranceProgress = null) {
    const halfWidth = camera.position.distanceTo(catalogCenter) *
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    const halfCount = this.wheels.length / 2;
    for (const [index, wheel] of this.wheels.entries()) {
      if (entranceProgress !== null && index === 0) continue;
      const offset = wrap(index - this.phase + halfCount, this.wheels.length) - halfCount;
      const distance = Math.abs(offset);
      const side = Math.sign(offset);
      const arrival = entranceProgress === null ? 1 : THREE.MathUtils.smootherstep(
        entranceProgress, side < 0 ? .34 : .44, side < 0 ? .94 : 1,
      );
      wheel.visible = arrival > 0;
      if (!wheel.visible) continue;
      const approach = 1 - arrival;
      // Hide the wrap outside the frame while keeping the diagonal row readable.
      const exit = side * 0.58 * THREE.MathUtils.smoothstep(distance, 1, halfCount);
      const drift = reducedMotion ? 0 : Math.sin(this.motionTime * 1.65 + index * 1.8);
      wheel.position.set(
        (offset * .61 + exit + side * 1.85 * approach) * halfWidth,
        catalogCenter.y + offset * .78 + drift * .037 + Math.abs(this.lean) * .08 + side * .95 * approach,
        (offset >= 0 ? .24 : -.93) * distance - 6 * approach,
      );
      this.rockingEuler.set(drift * .025, this.lean * .06 - side * .42 * approach, drift * .018 - this.lean * .092 + side * .22 * approach);
      this.rockingRotation.setFromEuler(this.rockingEuler);
      wheel.quaternion.copy(catalogRotation).multiply(this.rockingRotation);
      if (index === this.index) {
        this.inspectionRotation.setFromEuler(this.inspectionEuler);
        wheel.quaternion.premultiply(this.inspectionRotation);
      }
      const displayScale = 1 + (offset > 0 ? .025 : -.11) * Math.min(distance, 1);
      wheel.scale.copy(this.baseScale).multiplyScalar(displayScale * (1 - .28 * approach));
    }
  }
}
