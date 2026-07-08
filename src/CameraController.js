import * as THREE from "three";
import { gsap } from "gsap";
import {
  normalizeAngle,
  smoothTowardAngle,
  computeFramingDistance,
  clampDistance,
  pointAlong,
} from "./cameraMath.js";

const EYE_HEIGHT = 1.8;
const YAW_LAMBDA = 12;    // suavizado del giro
const LOOK_LAMBDA = 12;   // slerp de mirada al estar bloqueado
const MOVE_LAMBDA = 10;   // rampa de aceleración/frenado
const MOVE_SPEED = 10.0;
const WALL_MARGIN = 0.6;  // margen a paredes de la sala
const COLLIDE_MARGIN = 0.3;
const FOCUS_GUARD = 0.35;
const FRAME_MARGIN = 1.15;

export default class CameraController {
  constructor({ camera, domElement, getColliders, hallBounds, onRelease, onSelectNearest }) {
    this.camera = camera;
    this.dom = domElement;
    this.getColliders = getColliders || (() => []);
    this.hallBounds = hallBounds || { width: 34, length: 34 };
    this.onRelease = onRelease || (() => {});
    this.onSelectNearest = onSelectNearest || (() => {});

    this._yaw = camera.rotation.y || 0;
    this._targetYaw = this._yaw;

    this._keys = { w: false, s: false, a: false, d: false };
    this._vel = new THREE.Vector3();

    this.isViewLocked = false;
    this.isTweening = false;
    this._lockedTarget = new THREE.Vector3();

    this._dummy = new THREE.Object3D();
    this._raycaster = new THREE.Raycaster();

    this._initialPos = camera.position.clone();
    this._initialYaw = this._yaw;

    this._dragging = false;
    this._lastX = 0;
    this._sensitivity = 0.002;

    this._bind();
  }

  _bind() {
    this._onMouseDown = (e) => {
      if (this.isViewLocked || this.isTweening) return;
      this._dragging = true;
      this._lastX = e.clientX;
    };
    this._onMouseUp = () => { this._dragging = false; };
    this._onMouseMove = (e) => {
      if (!this._dragging || this.isViewLocked || this.isTweening) return;
      const dx = e.clientX - this._lastX;
      this._lastX = e.clientX;
      this._targetYaw = normalizeAngle(this._targetYaw - dx * this._sensitivity);
    };
    this._onKeyDown = (e) => {
      if (e.code === "Escape") { this.release(); return; }
      if (this.isViewLocked) return;
      if (e.code === "KeyW") this._keys.w = true;
      if (e.code === "KeyS") this._keys.s = true;
      if (e.code === "KeyA") this._keys.a = true;
      if (e.code === "KeyD") this._keys.d = true;
      if (e.code === "Space") this.onSelectNearest();
    };
    this._onKeyUp = (e) => {
      if (e.code === "KeyW") this._keys.w = false;
      if (e.code === "KeyS") this._keys.s = false;
      if (e.code === "KeyA") this._keys.a = false;
      if (e.code === "KeyD") this._keys.d = false;
    };
    this.dom.addEventListener("mousedown", this._onMouseDown);
    window.addEventListener("mouseup", this._onMouseUp);
    this.dom.addEventListener("mousemove", this._onMouseMove);
    document.addEventListener("keydown", this._onKeyDown);
    document.addEventListener("keyup", this._onKeyUp);
  }

  dispose() {
    this.dom.removeEventListener("mousedown", this._onMouseDown);
    window.removeEventListener("mouseup", this._onMouseUp);
    this.dom.removeEventListener("mousemove", this._onMouseMove);
    document.removeEventListener("keydown", this._onKeyDown);
    document.removeEventListener("keyup", this._onKeyUp);
    gsap.killTweensOf(this.camera.position);
  }

  update(dt) {
    if (this.isViewLocked) {
      this._dummy.position.copy(this.camera.position);
      this._dummy.lookAt(this._lockedTarget);
      const a = 1 - Math.exp(-LOOK_LAMBDA * dt);
      this.camera.quaternion.slerp(this._dummy.quaternion, a);
      return;
    }
    if (!this.isTweening) this._updateMovement(dt);
    this._updateYaw(dt);
  }

  _updateYaw(dt) {
    this._yaw = smoothTowardAngle(this._yaw, this._targetYaw, YAW_LAMBDA, dt);
    this.camera.up.set(0, 1, 0);
    this.camera.rotation.set(0, this._yaw, 0);
  }

  _updateMovement(dt) {
    let f = 0, s = 0;
    if (this._keys.w) f += 1;
    if (this._keys.s) f -= 1;
    if (this._keys.a) s -= 1;
    if (this._keys.d) s += 1;
    const len = Math.hypot(f, s);
    if (len > 0) { f /= len; s /= len; }

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() > 0) fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() > 0) right.normalize();

    const desired = new THREE.Vector3()
      .addScaledVector(fwd, f * MOVE_SPEED)
      .addScaledVector(right, s * MOVE_SPEED);

    const a = 1 - Math.exp(-MOVE_LAMBDA * dt);
    this._vel.lerp(desired, a);
    if (this._vel.lengthSq() < 1e-6) return;

    const prev = this.camera.position.clone();
    this.camera.position.addScaledVector(this._vel, dt);
    this.camera.position.y = EYE_HEIGHT;

    const halfW = this.hallBounds.width / 2 - WALL_MARGIN;
    const halfL = this.hallBounds.length / 2 - WALL_MARGIN;
    this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -halfW, halfW);
    this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -halfL, halfL);

    const cam = this.camera.position;
    const hit = this.getColliders().some((m) => {
      const b = new THREE.Box3().setFromObject(m);
      return (
        cam.x > b.min.x - COLLIDE_MARGIN && cam.x < b.max.x + COLLIDE_MARGIN &&
        cam.z > b.min.z - COLLIDE_MARGIN && cam.z < b.max.z + COLLIDE_MARGIN
      );
    });
    if (hit) {
      this.camera.position.copy(prev);
      this.camera.position.y = EYE_HEIGHT;
      this._vel.set(0, 0, 0);
    }
  }

  focusOn(artwork) {
    const group = artwork && artwork.mesh;
    if (!group) return;
    group.updateWorldMatrix(true, true);
    const bbox = new THREE.Box3().setFromObject(group);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    let normal = artwork._normal
      ? artwork._normal.clone()
      : new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), group.rotation.y);
    normal.y = 0;
    if (normal.lengthSq() === 0) normal.set(0, 0, 1);
    normal.normalize();

    const w = Math.max(size.x, size.z); // ancho a lo largo de la pared
    const h = size.y;
    const desired = computeFramingDistance(w, h, this.camera.fov, FRAME_MARGIN);

    // Rayo desde el centro hacia fuera para hallar el obstáculo más cercano
    this._raycaster.set(center.clone().addScaledVector(normal, 0.05), normal);
    const hits = this._raycaster.intersectObjects(this.getColliders(), true);
    const maxTravel = hits.length ? hits[0].distance : Infinity;
    const dist = clampDistance(desired, maxTravel, FOCUS_GUARD, 0.6);

    const dest = pointAlong(center, normal, dist);
    dest.y = center.y;

    this._lockedTarget.copy(center);
    this.isViewLocked = true;
    this.isTweening = true;
    this._dragging = false;
    this.camera.up.set(0, 1, 0);

    gsap.killTweensOf(this.camera.position);
    gsap.to(this.camera.position, {
      x: dest.x, y: dest.y, z: dest.z,
      duration: 1.0, ease: "power3.inOut",
      onComplete: () => { this.isTweening = false; },
    });
  }

  release() {
    const wasActive = this.isViewLocked || this.isTweening;
    this.isViewLocked = false;

    // Derivar el yaw actual desde el forward de la cámara (sin salto)
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() > 0) fwd.normalize();
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    this._yaw = normalizeAngle(yaw);
    this._targetYaw = this._yaw;
    this.camera.up.set(0, 1, 0);
    this.camera.rotation.set(0, this._yaw, 0);

    gsap.killTweensOf(this.camera.position);
    this.isTweening = true;
    gsap.to(this.camera.position, {
      y: EYE_HEIGHT, duration: 0.6, ease: "power3.inOut",
      onComplete: () => { this.isTweening = false; },
    });

    if (wasActive) this.onRelease();
  }

  reset() {
    gsap.killTweensOf(this.camera.position);
    this.isViewLocked = false;
    this.isTweening = false;
    this._dragging = false;
    this._vel.set(0, 0, 0);
    this.camera.position.copy(this._initialPos);
    this._yaw = this._initialYaw;
    this._targetYaw = this._initialYaw;
    this.camera.up.set(0, 1, 0);
    this.camera.rotation.set(0, this._yaw, 0);
  }
}
