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

const DEG2RAD = Math.PI / 180;

/**
 * Distancia para encuadrar una obra de tamaño w×h dado el FOV vertical (grados).
 * Usa la dimensión mayor y un margen (>1 aleja un poco).
 */
export function computeFramingDistance(w, h, fovDeg, margin = 1.15) {
  const half = Math.max(w, h) * 0.5;
  return (half / Math.tan((fovDeg * DEG2RAD) / 2)) * margin;
}

/**
 * Recorta la distancia deseada para no atravesar el obstáculo más cercano.
 * maxTravel = distancia libre por delante (Infinity si no hay obstáculo).
 */
export function clampDistance(desired, maxTravel, guard = 0.35, min = 0.6) {
  const cap = Number.isFinite(maxTravel) ? Math.max(min, maxTravel - guard) : desired;
  return Math.max(min, Math.min(desired, cap));
}

/** Devuelve un nuevo THREE.Vector3 = origin + dir*dist (dir debe estar normalizado). */
export function pointAlong(origin, dir, dist) {
  return origin.clone().add(dir.clone().multiplyScalar(dist));
}
