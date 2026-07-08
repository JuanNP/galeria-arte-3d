import { describe, it, expect } from "vitest";
import * as THREE from "three";
import CameraController from "../src/CameraController.js";

// domElement/documento simulados (sin DOM real en Node)
function fakeDom() {
  return { addEventListener() {}, removeEventListener() {} };
}
// Parchear los objetos globales que el controlador escucha
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
globalThis.document = globalThis.document || { addEventListener() {}, removeEventListener() {} };

function makeCamera() {
  const cam = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  cam.position.set(0, 1.8, 8);
  cam.rotation.set(0, 0, 0);
  return cam;
}

describe("CameraController movimiento/giro", () => {
  it("suaviza el yaw hacia el objetivo", () => {
    const cam = makeCamera();
    const c = new CameraController({
      camera: cam,
      domElement: fakeDom(),
      getColliders: () => [],
      hallBounds: { width: 34, length: 34 },
    });
    c._targetYaw = 1.0;
    for (let i = 0; i < 120; i++) c.update(1 / 60);
    expect(cam.rotation.y).toBeCloseTo(1.0, 2);
  });

  it("avanza con W a lo largo de -Z y respeta límites de sala", () => {
    const cam = makeCamera();
    const c = new CameraController({
      camera: cam,
      domElement: fakeDom(),
      getColliders: () => [],
      hallBounds: { width: 34, length: 34 },
    });
    c._keys.w = true;
    for (let i = 0; i < 600; i++) c.update(1 / 60);
    expect(cam.position.z).toBeGreaterThanOrEqual(-34 / 2 + 0.6 - 1e-3);
    expect(cam.position.z).toBeLessThan(8);
    expect(cam.position.y).toBeCloseTo(1.8, 6);
  });
});

function makeArtwork(center, normal, size) {
  // Grupo con un mesh hijo de tamaño `size` centrado en `center`.
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  group.add(mesh);
  group.position.copy(center);
  group.updateWorldMatrix(true, true);
  return { mesh: group, _normal: normal.clone() };
}

describe("CameraController focusOn/release", () => {
  it("coloca la cámara frente a la obra a lo largo de su normal", () => {
    const cam = makeCamera();
    const c = new CameraController({
      camera: cam,
      domElement: fakeDom(),
      getColliders: () => [],
      hallBounds: { width: 34, length: 34 },
    });
    const center = new THREE.Vector3(16.8, 2, 0);
    const normal = new THREE.Vector3(-1, 0, 0);
    const art = makeArtwork(center, normal, new THREE.Vector3(0.1, 2, 2));

    c.focusOn(art);
    expect(c.isViewLocked).toBe(true);
    expect(c._lockedTarget.x).toBeCloseTo(center.x, 3);
    expect(c._lockedTarget.z).toBeCloseTo(center.z, 3);
  });

  it("release desbloquea y sincroniza el yaw sin salto", () => {
    const cam = makeCamera();
    const c = new CameraController({
      camera: cam,
      domElement: fakeDom(),
      getColliders: () => [],
      hallBounds: { width: 34, length: 34 },
    });
    cam.lookAt(new THREE.Vector3(cam.position.x + 1, cam.position.y, cam.position.z));
    c.isViewLocked = true;
    c.release();
    expect(c.isViewLocked).toBe(false);
    expect(c._targetYaw).toBeCloseTo(c._yaw, 6);
  });
});

describe("CameraController _computeFocus / eventos / colisión", () => {
  it("encuadra a la distancia calculada frente a la obra (sin obstáculos)", () => {
    const cam = makeCamera();
    const c = new CameraController({ camera: cam, domElement: fakeDom(), getColliders: () => [], hallBounds: { width: 34, length: 34 } });
    const center = new THREE.Vector3(16.8, 2, 0);
    const normal = new THREE.Vector3(-1, 0, 0);
    const art = makeArtwork(center, normal, new THREE.Vector3(0.1, 2, 2));
    const f = c._computeFocus(art);
    // computeFramingDistance(2,2,75,1.15) ≈ 1.4987
    expect(f.dist).toBeCloseTo(1.4987, 2);
    expect(f.dest.x).toBeCloseTo(16.8 - 1.4987, 2);
    expect(f.dest.y).toBeCloseTo(2, 3);
    expect(f.dest.z).toBeCloseTo(0, 3);
  });

  it("_onKeyDown W avanza y un colisionador enfrente lo detiene", () => {
    const cam = makeCamera();
    const blocker = new THREE.Mesh(new THREE.BoxGeometry(40, 6, 2), new THREE.MeshBasicMaterial());
    blocker.position.set(0, 3, 5); // ocupa z ∈ [4,6]
    blocker.updateWorldMatrix(true, true);
    const c = new CameraController({ camera: cam, domElement: fakeDom(), getColliders: () => [blocker], hallBounds: { width: 34, length: 34 } });
    c._onKeyDown({ code: "KeyW" });
    for (let i = 0; i < 120; i++) c.update(1 / 60);
    // El colisionador bloquea el avance por -Z: no cruza su cara trasera (z≈6)
    expect(cam.position.z).toBeGreaterThan(6.0 - 1e-3);
    // Sin bloqueo habría avanzado mucho más allá
    expect(cam.position.z).toBeLessThan(8);
  });

  it("release sin vista activa no congela el movimiento", () => {
    const cam = makeCamera();
    const c = new CameraController({ camera: cam, domElement: fakeDom(), getColliders: () => [], hallBounds: { width: 34, length: 34 } });
    c.release(); // nada estaba bloqueado
    expect(c.isTweening).toBe(false);
  });
});
