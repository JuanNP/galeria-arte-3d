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
