import { describe, it, expect } from "vitest";
import { normalizeAngle, damp, smoothTowardAngle } from "../src/cameraMath.js";

describe("normalizeAngle", () => {
  it("mantiene 0 en 0", () => {
    expect(normalizeAngle(0)).toBeCloseTo(0, 6);
  });
  it("envuelve 1.5π a -0.5π", () => {
    expect(normalizeAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2, 6);
  });
  it("envuelve -1.5π a 0.5π", () => {
    expect(normalizeAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe("damp", () => {
  it("con dt=0 devuelve el valor actual", () => {
    expect(damp(3, 10, 5, 0)).toBeCloseTo(3, 6);
  });
  it("se acerca al objetivo al aumentar dt", () => {
    const a = damp(0, 10, 5, 0.1);
    const b = damp(0, 10, 5, 0.5);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(10);
  });
});

describe("smoothTowardAngle", () => {
  it("toma el camino corto cruzando ±π", () => {
    const next = smoothTowardAngle(3.0, -3.0, 10, 0.016);
    const delta = normalizeAngle(next - 3.0);
    expect(delta).toBeGreaterThan(0);
  });
  it("con dt grande casi alcanza el objetivo", () => {
    const next = smoothTowardAngle(0, 1, 10, 5);
    expect(next).toBeCloseTo(1, 3);
  });
});

import * as THREE from "three";
import { computeFramingDistance, clampDistance, pointAlong } from "../src/cameraMath.js";

describe("computeFramingDistance", () => {
  it("obra 2x2, fov 75°, margen 1.15", () => {
    // half = 1; tan(37.5°) ≈ 0.76733; 1/0.76733*1.15 ≈ 1.4987
    const d = computeFramingDistance(2, 2, 75, 1.15);
    expect(d).toBeCloseTo(1.4987, 2);
  });
  it("usa la dimensión mayor (obra ancha)", () => {
    const wide = computeFramingDistance(4, 1, 75, 1.0);
    const tall = computeFramingDistance(1, 4, 75, 1.0);
    expect(wide).toBeCloseTo(tall, 6);
  });
});

describe("clampDistance", () => {
  it("respeta el deseado si hay espacio de sobra", () => {
    expect(clampDistance(2, Infinity, 0.35, 0.6)).toBeCloseTo(2, 6);
  });
  it("recorta a maxTravel - guard", () => {
    expect(clampDistance(5, 3, 0.35, 0.6)).toBeCloseTo(2.65, 6);
  });
  it("nunca baja del mínimo", () => {
    expect(clampDistance(5, 0.5, 0.35, 0.6)).toBeCloseTo(0.6, 6);
  });
});

describe("pointAlong", () => {
  it("proyecta origen + dir*dist", () => {
    const p = pointAlong(new THREE.Vector3(0, 2, 0), new THREE.Vector3(1, 0, 0), 3);
    expect(p.x).toBeCloseTo(3, 6);
    expect(p.y).toBeCloseTo(2, 6);
    expect(p.z).toBeCloseTo(0, 6);
  });
});
