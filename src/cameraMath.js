// Funciones puras de cámara. Sin dependencias de DOM ni WebGL.

const TWO_PI = Math.PI * 2;

/** Normaliza un ángulo a [-π, π]. */
export function normalizeAngle(a) {
  return (((a + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI - Math.PI;
}

/**
 * Suavizado exponencial independiente del framerate.
 * lambda = velocidad de aproximación; dt = segundos del frame.
 */
export function damp(current, target, lambda, dt) {
  return target + (current - target) * Math.exp(-lambda * dt);
}

/** Suaviza un ángulo tomando siempre el camino más corto (envuelve ±π). */
export function smoothTowardAngle(current, target, lambda, dt) {
  const delta = normalizeAngle(target - current);
  return normalizeAngle(current + delta * (1 - Math.exp(-lambda * dt)));
}
