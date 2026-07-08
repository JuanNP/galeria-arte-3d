# Galería 3D — Fixes, optimización y controles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir el encuadre de obras (incl. paneles intermedios y paredes norte/sur), optimizar el render y suavizar los controles, extrayendo la cámara/controles a un módulo `CameraController`.

**Architecture:** Se crea `src/CameraController.js` (estado de cámara, input mouse/teclado, movimiento WASD, giro yaw, modo "ver obra") apoyado en funciones puras testeables en `src/cameraMath.js`. `src/gallery.js` mantiene escena/luces/obras/sala y delega la cámara al controlador. Optimizaciones: eliminar luces de relleno inútiles, downscale de texturas (`src/textureUtils.js`), geometrías/materiales compartidos y `dispose()`.

**Tech Stack:** React 18, Three.js 0.158, GSAP 3, Vite 5. Tests con Vitest (nuevo), entorno Node (las clases matemáticas de Three.js corren sin WebGL/DOM).

---

## Estructura de archivos

- **Crear** `src/cameraMath.js` — funciones puras: `normalizeAngle`, `damp`, `smoothTowardAngle`, `computeFramingDistance`, `clampDistance`, `pointAlong`.
- **Crear** `src/textureUtils.js` — `computeDownscaleSize`.
- **Crear** `src/CameraController.js` — clase controladora de cámara/input.
- **Crear** `vitest.config.js` — config de tests.
- **Crear** `tests/cameraMath.test.js`, `tests/textureUtils.test.js`, `tests/CameraController.test.js`.
- **Modificar** `src/gallery.js` — integrar el controlador; eliminar código muerto de "corridor"; optimizaciones de luces/geometrías/texturas; `dispose()`.
- **Modificar** `src/App.jsx` — llamar `dispose()` en cleanup.
- **Modificar** `package.json` — devDependency `vitest` + script `test`.

---

## Task 1: Configurar Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.js`
- Create: `tests/smoke.test.js`

- [ ] **Step 1: Instalar Vitest**

Run: `npm install -D vitest`
Expected: `vitest` aparece en `devDependencies` de `package.json`.

- [ ] **Step 2: Añadir script de test**

Editar `package.json`, en `"scripts"` añadir:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Crear `vitest.config.js`**

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
  },
});
```

- [ ] **Step 4: Crear un smoke test**

`tests/smoke.test.js`:

```js
import { describe, it, expect } from "vitest";
import * as THREE from "three";

describe("entorno de test", () => {
  it("carga Three.js y opera vectores", () => {
    const v = new THREE.Vector3(1, 2, 3);
    expect(v.length()).toBeCloseTo(Math.sqrt(14), 5);
  });
});
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.js tests/smoke.test.js
git commit -m "test: configura Vitest y smoke test"
```

---

## Task 2: `cameraMath` — ángulos y suavizado

**Files:**
- Create: `src/cameraMath.js`
- Test: `tests/cameraMath.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

`tests/cameraMath.test.js`:

```js
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
    // de 3.0 rad hacia -3.0 rad: el camino corto es +, cruzando π
    const next = smoothTowardAngle(3.0, -3.0, 10, 0.016);
    // debe moverse hacia arriba (cruzando π), no bajar por 0
    const delta = normalizeAngle(next - 3.0);
    expect(delta).toBeGreaterThan(0);
  });
  it("con dt grande casi alcanza el objetivo", () => {
    const next = smoothTowardAngle(0, 1, 10, 5);
    expect(next).toBeCloseTo(1, 3);
  });
});
```

- [ ] **Step 2: Ejecutar para ver el fallo**

Run: `npx vitest run tests/cameraMath.test.js`
Expected: FAIL ("Failed to resolve import ../src/cameraMath.js" / funciones no definidas).

- [ ] **Step 3: Implementar `cameraMath.js` (parte 1)**

`src/cameraMath.js`:

```js
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
```

- [ ] **Step 4: Ejecutar y verificar que pasan**

Run: `npx vitest run tests/cameraMath.test.js`
Expected: PASS (todos los tests de este archivo hasta ahora).

- [ ] **Step 5: Commit**

```bash
git add src/cameraMath.js tests/cameraMath.test.js
git commit -m "feat: cameraMath - normalizeAngle, damp, smoothTowardAngle"
```

---

## Task 3: `cameraMath` — encuadre y distancia

**Files:**
- Modify: `src/cameraMath.js`
- Test: `tests/cameraMath.test.js`

- [ ] **Step 1: Añadir tests que fallan**

Añadir al final de `tests/cameraMath.test.js`:

```js
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
```

- [ ] **Step 2: Ejecutar para ver el fallo**

Run: `npx vitest run tests/cameraMath.test.js`
Expected: FAIL (funciones no exportadas).

- [ ] **Step 3: Añadir implementación a `cameraMath.js`**

Añadir al final de `src/cameraMath.js`:

```js
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
```

- [ ] **Step 4: Ejecutar y verificar que pasan**

Run: `npx vitest run tests/cameraMath.test.js`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/cameraMath.js tests/cameraMath.test.js
git commit -m "feat: cameraMath - computeFramingDistance, clampDistance, pointAlong"
```

---

## Task 4: `textureUtils` — downscale

**Files:**
- Create: `src/textureUtils.js`
- Test: `tests/textureUtils.test.js`

- [ ] **Step 1: Escribir el test que falla**

`tests/textureUtils.test.js`:

```js
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
```

- [ ] **Step 2: Ejecutar para ver el fallo**

Run: `npx vitest run tests/textureUtils.test.js`
Expected: FAIL (import no resuelto).

- [ ] **Step 3: Implementar `textureUtils.js`**

`src/textureUtils.js`:

```js
/**
 * Calcula el tamaño (entero) al que reescalar una imagen para que su lado
 * largo no exceda `max`, preservando el aspecto. Si ya cabe, devuelve igual.
 */
export function computeDownscaleSize(w, h, max) {
  if (w <= max && h <= max) return { width: w, height: h };
  const scale = max / Math.max(w, h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npx vitest run tests/textureUtils.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/textureUtils.js tests/textureUtils.test.js
git commit -m "feat: textureUtils - computeDownscaleSize"
```

---

## Task 5: `CameraController` — movimiento y giro

**Files:**
- Create: `src/CameraController.js`
- Test: `tests/CameraController.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

`tests/CameraController.test.js`:

```js
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
    // No debe salir de la sala (media longitud - margen)
    expect(cam.position.z).toBeGreaterThanOrEqual(-34 / 2 + 0.6 - 1e-3);
    // Se movió hacia -Z respecto del inicio
    expect(cam.position.z).toBeLessThan(8);
    // Altura de ojos constante
    expect(cam.position.y).toBeCloseTo(1.8, 6);
  });
});
```

- [ ] **Step 2: Ejecutar para ver el fallo**

Run: `npx vitest run tests/CameraController.test.js`
Expected: FAIL (import no resuelto).

- [ ] **Step 3: Implementar `CameraController.js` (movimiento + giro + ciclo de vida)**

`src/CameraController.js`:

```js
import * as THREE from "three";
import { gsap } from "gsap";
import { normalizeAngle, smoothTowardAngle } from "./cameraMath.js";

const EYE_HEIGHT = 1.8;
const YAW_LAMBDA = 12;    // suavizado del giro
const LOOK_LAMBDA = 12;   // slerp de mirada al estar bloqueado
const MOVE_LAMBDA = 10;   // rampa de aceleración/frenado
const MOVE_SPEED = 10.0;
const WALL_MARGIN = 0.6;  // margen a paredes de la sala
const COLLIDE_MARGIN = 0.3;

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

  // focusOn / release / reset se implementan en la Task 6.
}
```

- [ ] **Step 4: Ejecutar y verificar que pasan**

Run: `npx vitest run tests/CameraController.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/CameraController.js tests/CameraController.test.js
git commit -m "feat: CameraController - movimiento WASD y giro yaw suavizado"
```

---

## Task 6: `CameraController` — focusOn / release / reset

**Files:**
- Modify: `src/CameraController.js`
- Test: `tests/CameraController.test.js`

- [ ] **Step 1: Añadir tests que fallan**

Añadir al final de `tests/CameraController.test.js`:

```js
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
      getColliders: () => [], // sin obstáculos
      hallBounds: { width: 34, length: 34 },
    });
    // Obra en pared este (x=+17), mirando -X, tamaño 2x2
    const center = new THREE.Vector3(16.8, 2, 0);
    const normal = new THREE.Vector3(-1, 0, 0);
    const art = makeArtwork(center, normal, new THREE.Vector3(0.1, 2, 2));

    c.focusOn(art);
    expect(c.isViewLocked).toBe(true);
    // La cámara destino está en center + normal*dist => x menor que el centro
    // (aún no animada por GSAP en test; validamos el objetivo bloqueado)
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
    // Orientar la cámara mirando +X (como si viera una obra a su derecha)
    cam.lookAt(new THREE.Vector3(cam.position.x + 1, cam.position.y, cam.position.z));
    c.isViewLocked = true;
    c.release();
    expect(c.isViewLocked).toBe(false);
    // El yaw objetivo quedó sincronizado con el yaw actual (sin salto)
    expect(c._targetYaw).toBeCloseTo(c._yaw, 6);
  });
});
```

- [ ] **Step 2: Ejecutar para ver el fallo**

Run: `npx vitest run tests/CameraController.test.js`
Expected: FAIL (`focusOn`/`release` no definidos → `c.focusOn is not a function`).

- [ ] **Step 3: Implementar `focusOn`, `release`, `reset`**

En `src/CameraController.js`, reemplazar el comentario `// focusOn / release / reset se implementan en la Task 6.` por:

```js
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
```

- [ ] **Step 4: Añadir los imports y constantes que faltan**

En `src/CameraController.js`, actualizar la línea de import de `cameraMath` para incluir todo lo usado:

```js
import {
  normalizeAngle,
  smoothTowardAngle,
  computeFramingDistance,
  clampDistance,
  pointAlong,
} from "./cameraMath.js";
```

Y añadir junto a las demás constantes de arriba:

```js
const FOCUS_GUARD = 0.35;
const FRAME_MARGIN = 1.15;
```

- [ ] **Step 5: Ejecutar y verificar que pasan**

Run: `npx vitest run tests/CameraController.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/CameraController.js tests/CameraController.test.js
git commit -m "feat: CameraController - focusOn por normal, release sin salto y reset"
```

---

## Task 7: Integrar `CameraController` en `gallery.js`

**Files:**
- Modify: `src/gallery.js` (init, setupControls, animate, select/deselect/reset)

- [ ] **Step 1: Crear el controlador en `init()`**

En `src/gallery.js`, método `init()` (línea ~23), reemplazar:

```js
  init() {
    this.setupScene();
    this.setupCamera();
    this.setupRenderer();
    this.setupControls();
    this.setupLights();
    this.createRooms();
    this.createArtworks();
    this.animate();
    this.hideLoadingScreen();
  }
```

por:

```js
  init() {
    this.setupScene();
    this.setupCamera();
    this.setupRenderer();
    this.createRooms();      // crea this.hall (necesario para el controlador)
    this.setupControls();    // ahora solo raycasting de hover/click
    this.setupCameraController();
    this.setupLights();
    this.createArtworks();
    this.animate();
    this.hideLoadingScreen();
  }
```

- [ ] **Step 2: Añadir `setupCameraController()` y el import**

Al inicio de `src/gallery.js`, tras `import { gsap } from "gsap";`, añadir:

```js
import CameraController from "./CameraController.js";
```

Añadir el método (por ejemplo, justo después de `setupControls()`):

```js
  setupCameraController() {
    this.camControls = new CameraController({
      camera: this.camera,
      domElement: this.renderer.domElement,
      getColliders: () => this._colliders || [],
      hallBounds: { width: this.hall.width, length: this.hall.length },
      onRelease: () => this.onArtworkSelect?.(null),
      onSelectNearest: () => this.selectNearestArtwork(),
    });
  }
```

- [ ] **Step 3: Reducir `setupControls()` a solo raycasting**

Reemplazar TODO el cuerpo del método `setupControls()` (actualmente ~líneas 355–503) por:

```js
  setupControls() {
    // Raycasting para hover/click en obras (el input de cámara vive en CameraController)
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const mouse = new THREE.Vector2();
    const getIntersections = (event) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(mouse, this.camera);
      const meshes = this.artworks.map((a) => a && a.mesh).filter(Boolean);
      return raycaster.intersectObjects(meshes, true);
    };

    let hoverRAF = null;
    let lastMoveEvt = null;
    let lastHover = null;
    this.renderer.domElement.addEventListener("mousemove", (event) => {
      if (this.camControls?.isViewLocked || this.camControls?.isTweening) return;
      lastMoveEvt = event;
      if (hoverRAF) return;
      hoverRAF = requestAnimationFrame(() => {
        hoverRAF = null;
        const hits = getIntersections(lastMoveEvt);
        const hit = hits.find((h) => h.object?.parent);
        const group = hit?.object?.parent;
        if (lastHover && lastHover !== group) this.highlightArtwork(lastHover, false);
        if (group) {
          this.highlightArtwork(group, true);
          lastHover = group;
          this.renderer.domElement.style.cursor = "pointer";
        } else {
          this.renderer.domElement.style.cursor = "default";
          lastHover = null;
        }
      });
    });

    this.renderer.domElement.addEventListener("click", (event) => {
      if (this.camControls?.isViewLocked || this.camControls?.isTweening) return;
      const hits = getIntersections(event);
      const hit = hits.find((h) => h.object?.parent);
      const group = hit?.object?.parent;
      if (!group) return;
      const art = this.artworks.find((a) => a.mesh === group);
      if (art) this.selectArtwork(art);
    });
  }
```

- [ ] **Step 4: Simplificar `setupCamera()` (quitar estado migrado)**

En `setupCamera()` eliminar las asignaciones de estado que ahora vive en el controlador (todo el bloque de `_lookAtTarget`, `_targetLerp`, `_slerpFactor`, `_mouseSensitivity`, `_maxPitch`, `_lookRadius`, `_lookAtTargetDesired`, `_isViewLocked`, `_lockedTarget`, `_keys`, `_moveSpeed`, márgenes `_corridor*`). Mantener SOLO:

```js
  setupCamera() {
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 1.8, 8);
    this.camera.lookAt(0, 1.8, 0);
    this.camera.layers.enable(1);
    this._clock = new THREE.Clock();
    this._colliders = [];
    // Auto-iluminación sutil / material unlit de las obras
    this._artEmissiveBoost = 0.45;
    this._artUnlit = true;
    this._artUnlitBrightness = 0.25;
    this._artBottomMargin = 1.1;
    // Cap opcional de FPS
    this._fpsCap = 60;
    this._lastFrameTime = 0;
  }
```

- [ ] **Step 5: Reemplazar `selectArtwork`, `deselectArtwork`, `resetCamera`**

Reemplazar el método `selectArtwork(artwork)` (~1556–1626) por:

```js
  selectArtwork(artwork) {
    if (!artwork || !artwork.mesh) return;
    this.onArtworkSelect?.(artwork);
    this.camControls.focusOn(artwork);
  }
```

Reemplazar `deselectArtwork()` (~1628–1687) por:

```js
  deselectArtwork() {
    this.selectedArtwork = null;
    this.camControls?.release();
  }
```

Reemplazar `resetCamera()` (~1726–1748) por:

```js
  resetCamera() {
    if (!this.camControls) return;
    this.camControls.reset();
    this.onArtworkSelect?.(null);
  }
```

- [ ] **Step 6: Actualizar el bucle `animate()`**

Reemplazar `animate()` (~1766–1786) por:

```js
  animate() {
    this._rafId = requestAnimationFrame(() => this.animate());
    if (this._fpsCap && this._fpsCap > 0) {
      const now = performance.now();
      const minMs = 1000 / this._fpsCap;
      if (this._lastFrameTime && now - this._lastFrameTime < minMs) return;
      this._lastFrameTime = now;
    }
    const dt = this._clock.getDelta();
    this.camControls.update(dt);
    this._dynamicResTick(dt * 1000);
    this._updateCulling();
    this._updateLOD();
    this.renderer.render(this.scene, this.camera);
  }
```

- [ ] **Step 7: Verificar build y tipos**

Run: `npm run build`
Expected: build OK sin errores de referencias a métodos borrados (`_updateMovement`, `_updateSmoothLook`, `updateCameraRotation`). Si el build falla por referencias, se resuelven en la Task 8 (limpieza). Si falla por otra razón, corregir aquí.

- [ ] **Step 8: Verificación manual en la app**

Usar la skill `run` (o `npm run dev:local`, abrir `http://localhost:3001`).
Verificar:
- Arrastrar el mouse gira suave y estable; se conserva giro 360° horizontal, sin inclinación vertical.
- W/S/A/D mueven con arranque/frenado suave; no atraviesa paneles ni paredes.
- Clic o Espacio sobre una obra encuadra de frente, centrada, a distancia correcta — probar en pared oeste, este, norte, sur y en **ambos lados de los dos paneles intermedios**.
- La cámara no atraviesa el panel/pared opuesto al encuadrar.
- Escape y "Salir de obra" devuelven a navegación libre sin salto de orientación.

- [ ] **Step 9: Commit**

```bash
git add src/gallery.js
git commit -m "feat: gallery delega camara/controles a CameraController"
```

---

## Task 8: Eliminar código muerto de "corridor"

**Files:**
- Modify: `src/gallery.js`

- [ ] **Step 1: Borrar métodos y helpers no usados**

Eliminar por completo de `src/gallery.js`:
- `_updateSmoothLook()` (~505–534)
- `_updateMovement(dt)` (~536–611)
- `updateCameraRotation` (asignado dentro del viejo `setupControls`, ya eliminado en Task 7)
- `createLightTracks()` (~1039–1041, cuerpo vacío)
- `repositionArtworksAlongCorridor()` (~1080–1112)
- `updateCorridorMargins(start, end)` (~1114–1139)

- [ ] **Step 2: Buscar referencias residuales a `corridor`**

Run: `grep -n "corridor\|_updateMovement\|_updateSmoothLook\|updateCameraRotation\|repositionArtworksAlongCorridor\|updateCorridorMargins\|_lookAtTarget\|_isViewLocked" src/gallery.js`
Expected: sin resultados relevantes. Si aparece alguno en `rebuildArtworkSpots` (usa `this.corridor?.wallHeight`), reemplazar `this.corridor?.wallHeight || 6` por `this.hall?.height || 6`.

- [ ] **Step 3: Verificar build y tests**

Run: `npm run build && npm test`
Expected: build OK; todos los tests PASS.

- [ ] **Step 4: Verificación manual rápida**

`npm run dev:local` → confirmar que la escena carga y los controles/selección siguen funcionando (regresión de Task 7).

- [ ] **Step 5: Commit**

```bash
git add src/gallery.js
git commit -m "refactor: elimina codigo muerto de la etapa corridor"
```

---

## Task 9: Optimización — quitar luces de relleno inútiles

**Files:**
- Modify: `src/gallery.js`

- [ ] **Step 1: Eliminar `_attachArtworkFillLight` y sus usos**

En `src/gallery.js`:
- Borrar el método `_attachArtworkFillLight(artworkGroup, w, h)` (~335–353).
- Borrar las 2 llamadas `this._attachArtworkFillLight(artworkGroup, data.size[0], data.size[1]);` dentro de `createArtwork` (una en la rama de imagen, ~línea 1409; otra en la rama generada, ~línea 1453).
- Borrar la propiedad `this._artFillLights = [];` del `constructor` (~línea 16).

- [ ] **Step 2: Verificar que no quedan referencias**

Run: `grep -n "_artFillLights\|_attachArtworkFillLight" src/gallery.js`
Expected: sin resultados.

- [ ] **Step 3: Verificación manual (sin regresión visual)**

`npm run dev:local` → las obras (material unlit) se ven exactamente igual de legibles que antes (las fill lights no las afectaban). Los marcos siguen iluminados por hemisphere/directional/point lights.

- [ ] **Step 4: Commit**

```bash
git add src/gallery.js
git commit -m "perf: elimina 12 spotlights de relleno sin efecto (material unlit)"
```

---

## Task 10: Optimización — geometrías/materiales compartidos + downscale de texturas

**Files:**
- Modify: `src/gallery.js`

- [ ] **Step 1: Crear geometrías y material de marco compartidos**

En `setupCamera()` (o en el `constructor`), tras `this._colliders = [];`, añadir:

```js
    // Recursos compartidos por todas las obras (evita duplicar geometrías/materiales)
    this._sharedFrameGeo = new THREE.BoxGeometry(1, 1, 0.1);
    this._sharedCanvasGeo = new THREE.PlaneGeometry(1, 1);
    this._sharedFrameMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.5,
      metalness: 0.05,
    });
```

- [ ] **Step 2: Usar los recursos compartidos en `createArtwork`**

En `createArtwork(data, index)`, reemplazar la creación de geometría/material del marco y del lienzo:

Reemplazar:

```js
    const frameGeometry = new THREE.BoxGeometry(1, 1, 0.1);
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.5,
      metalness: 0.05,
    });
    const frame = new THREE.Mesh(frameGeometry, frameMaterial);
```

por:

```js
    const frame = new THREE.Mesh(this._sharedFrameGeo, this._sharedFrameMat);
```

Y reemplazar `const canvasGeometry = new THREE.PlaneGeometry(1, 1);` por el uso directo de `this._sharedCanvasGeo` en las dos construcciones de `new THREE.Mesh(canvasGeometry, canvasMaterial)` → `new THREE.Mesh(this._sharedCanvasGeo, canvasMaterial)`. (El material del lienzo sigue siendo por-obra porque cada uno lleva su textura.)

- [ ] **Step 3: Añadir downscale en `_loadArtworkTexture`**

Añadir el import al inicio de `src/gallery.js`:

```js
import { computeDownscaleSize } from "./textureUtils.js";
```

Constante de tamaño máximo: en `setupCamera()` añadir `this._maxTextureSize = 2048;`

Reemplazar el cuerpo de `_loadArtworkTexture(url, onLoad, onError)` por:

```js
  _loadArtworkTexture(url, onLoad, onError) {
    const loader = new THREE.TextureLoader();
    const resolvedUrl = this._resolveAssetUrl(url);
    const maxSize = this._maxTextureSize || 2048;
    loader.load(
      resolvedUrl,
      (tex) => {
        const img = tex.image;
        const iw = img?.naturalWidth || img?.width || 0;
        const ih = img?.naturalHeight || img?.height || 0;
        let finalTex = tex;
        if (iw && ih && (iw > maxSize || ih > maxSize)) {
          const { width, height } = computeDownscaleSize(iw, ih, maxSize);
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          tex.dispose(); // liberar la textura full-res original
          finalTex = new THREE.CanvasTexture(canvas);
        }
        finalTex.colorSpace = THREE.SRGBColorSpace;
        finalTex.generateMipmaps = true;
        finalTex.minFilter = THREE.LinearMipmapLinearFilter;
        finalTex.magFilter = THREE.LinearFilter;
        finalTex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
        finalTex.needsUpdate = true;
        onLoad?.(finalTex);
      },
      undefined,
      (err) => {
        console.error(`❌ Error cargando textura: ${url}`, err);
        console.error(`📍 URL resuelta: ${resolvedUrl}`);
        onError?.(err);
      }
    );
  }
```

- [ ] **Step 4: Verificar build y tests**

Run: `npm run build && npm test`
Expected: build OK; tests PASS.

- [ ] **Step 5: Verificación manual**

`npm run dev:local`. En DevTools → Console, tras cargar, inspeccionar una textura (o añadir un `console.log` temporal del tamaño): las imágenes con lado > 2048 se cargan reescaladas. Las obras se ven bien. No hay marcos rotos ni geometrías mal escaladas (los `scale` por obra siguen aplicándose sobre las geometrías compartidas).

- [ ] **Step 6: Commit**

```bash
git add src/gallery.js
git commit -m "perf: geometrias/material de marco compartidos y downscale de texturas"
```

---

## Task 11: `dispose()` de la galería + limpieza en React

**Files:**
- Modify: `src/gallery.js`
- Modify: `src/App.jsx:53-61`

- [ ] **Step 1: Añadir `dispose()` a `gallery.js`**

Añadir el método (por ejemplo, tras `hideLoadingScreen()`):

```js
  dispose() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this.camControls?.dispose();
    // Liberar geometrías/materiales/texturas de la escena
    this.scene?.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        if (!m) return;
        if (m.map) m.map.dispose?.();
        if (m.emissiveMap) m.emissiveMap.dispose?.();
        m.dispose?.();
      });
    });
    this._sharedFrameGeo?.dispose?.();
    this._sharedCanvasGeo?.dispose?.();
    this._sharedFrameMat?.dispose?.();
    this.renderer?.dispose?.();
    const el = this.renderer?.domElement;
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
```

- [ ] **Step 2: Llamar `dispose()` en el cleanup de `App.jsx`**

En `src/App.jsx`, en el `useEffect` de montaje (líneas ~53–61), reemplazar el `return`:

```js
    return () => {
      isMounted = false;
      const container = document.getElementById("canvas-container");
      if (container && container.firstChild) {
        try {
          container.removeChild(container.firstChild);
        } catch {}
      }
    };
```

por:

```js
    return () => {
      isMounted = false;
      try {
        galleryRef.current?.dispose?.();
      } catch {}
      galleryRef.current = null;
    };
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 4: Verificación manual (sin fugas evidentes)**

`npm run dev:local`. Con la app cargada, forzar un remount (p. ej. editar y guardar para HMR, o navegar fuera y volver). En DevTools → Performance/Memory, confirmar que no crece indefinidamente el número de contextos WebGL ni de texturas al remontar. No debe quedar más de un `<canvas>` dentro de `#canvas-container`.

- [ ] **Step 5: Commit**

```bash
git add src/gallery.js src/App.jsx
git commit -m "perf: dispose() de recursos GPU y limpieza en desmontaje React"
```

---

## Task 12: Verificación final contra criterios de aceptación

**Files:** ninguno (solo verificación); corregir en su tarea si algo falla.

- [ ] **Step 1: Tests y build limpios**

Run: `npm test && npm run build`
Expected: todos los tests PASS; build OK.

- [ ] **Step 2: Recorrido manual completo**

`npm run dev:local` y validar TODOS los criterios del spec:

WS1 — Bugs/paredes intermedias:
- Seleccionar obras en oeste, este, norte, sur y en los 4 lados de paneles → encuadre correcto y centrado.
- La cámara nunca atraviesa pared/panel opuesto ni sale de la sala.
- Transiciones de entrada/salida suaves, sin flips.
- Escape / "Salir de obra" → navegación libre sin salto.

WS2 — Rendimiento:
- Escena sin las fill lights; obras legibles.
- Texturas grandes reescaladas (≤2048 lado largo).
- Sin geometrías/materiales duplicados por obra.
- Remontar no acumula recursos GPU.

WS3 — Controles:
- Giro suave e igual a distinto framerate (probar con throttling de CPU en DevTools).
- 360° horizontal conservado; sin pitch.
- WASD con arranque/frenado suave, sin input perdido.
- Sin estados de arrastre "pegados" al seleccionar obra o soltar fuera del canvas.

- [ ] **Step 3: Commit final (si hubo ajustes) y cierre**

```bash
git add -A
git commit -m "chore: verificacion final WS1-WS3" || echo "sin cambios que commitear"
```

Al completar: usar la skill `superpowers:finishing-a-development-branch` para decidir merge/PR.

---

## Self-review (cobertura del spec)

- **WS1 encuadre por normal** → Task 6 (`focusOn`) + Task 7 (integración) + Task 3 (`computeFramingDistance`, `clampDistance`, `pointAlong`).
- **WS1 clamp de seguridad** → Task 6 (raycast + `clampDistance`), verificado en Task 7/12.
- **WS1 mirada simplificada (sin espejo)** → Task 5/6 (`update` locked usa `lookAt` + slerp); espejo eliminado en Task 8.
- **WS1 release correcto (hall real)** → Task 6 (`release`), sin dependencia de `corridor`.
- **WS1 limpieza corridor** → Task 8.
- **WS2 quitar fill lights** → Task 9.
- **WS2 downscale texturas** → Task 4 (`computeDownscaleSize`) + Task 10.
- **WS2 geometrías/materiales compartidos** → Task 10.
- **WS2 dispose** → Task 11.
- **WS2 revisión de iluminación** → se limita a quitar las fill lights (Task 9); no se reducen point/directional lights para evitar regresiones visuales en escritorio (decisión consciente; se reevaluará si el perfilado muestra cuello de botella). Documentado aquí.
- **WS3 yaw independiente del framerate** → Task 2 (`smoothTowardAngle`) + Task 5.
- **WS3 solo horizontal** → Task 5 (`_updateYaw` fija pitch/roll a 0).
- **WS3 WASD con accel/decel** → Task 5 (`_updateMovement` con rampa de velocidad).
- **WS3 sensibilidad / sin drag pegado** → Task 5 (mouseup en window, gating en lock/tween).
