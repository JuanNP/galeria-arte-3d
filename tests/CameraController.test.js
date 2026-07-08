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
