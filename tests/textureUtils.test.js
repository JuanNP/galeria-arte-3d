import { describe, it, expect } from "vitest";
import { computeDownscaleSize } from "../src/textureUtils.js";

describe("computeDownscaleSize", () => {
  it("no cambia si ya cabe en el máximo", () => {
    expect(computeDownscaleSize(1024, 768, 2048)).toEqual({ width: 1024, height: 768 });
  });
  it("reescala preservando aspecto (lado largo = max)", () => {
    expect(computeDownscaleSize(4096, 2048, 2048)).toEqual({ width: 2048, height: 1024 });
  });
  it("reescala verticales", () => {
    expect(computeDownscaleSize(1000, 3000, 1500)).toEqual({ width: 500, height: 1500 });
  });
});
