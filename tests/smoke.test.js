import { describe, it, expect } from "vitest";
import * as THREE from "three";

describe("entorno de test", () => {
  it("carga Three.js y opera vectores", () => {
    const v = new THREE.Vector3(1, 2, 3);
    expect(v.length()).toBeCloseTo(Math.sqrt(14), 5);
  });
});
