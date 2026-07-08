# Spec — Galería 3D: bugs de visualización, optimización y controles

**Fecha:** 2026-07-08
**Alcance:** Puntos 1, 2 y 3 del plan de mejora (bugs de animación / paredes intermedias, optimización de carga y render, controles de movimiento). El punto 4 (rediseño del salón) queda para una fase posterior con su propio spec.
**Enfoque elegido:** Opción C (híbrido) — correcciones quirúrgicas en todo, extrayendo la lógica de cámara/selección/controles a un módulo dedicado `CameraController`.

## Decisiones tomadas

- **Modelo de control:** arrastrar-para-mirar (se mantiene, mejorado), **no** pointer-lock.
- **Vista vertical:** solo horizontal (sin pitch). Se conserva la amplitud de giro de 360°.
- **Plataforma prioritaria:** escritorio. No se invierte aún en controles táctiles/móvil.

## Contexto del código actual

- `src/gallery.js` (~1788 líneas) concentra escena, luces, sala, obras, cámara, input y animaciones.
- `src/App.jsx` gestiona intro, puertas, HUD y montaje del canvas.
- La sala real es `this.hall` (ancho 34, largo 34, alto 6) con dos paneles interiores en x=±6 (largo 16). Existe código heredado que asume un "pasillo" (`this.corridor`) que **no se instancia**, con largo 80 y ancho 6.
- Las obras se distribuyen por round-robin sobre todos los soportes (paredes perimetrales + ambos lados de cada panel). Cada obra guarda `data._normal` (vector unitario que apunta hacia el interior de la sala desde su superficie).
- Las obras usan material **unlit** (`_artUnlit = true` → `MeshBasicMaterial`), por lo que las luces no las afectan.

## Arquitectura objetivo

Nuevo módulo `src/CameraController.js` que encapsula estado de cámara, input (mouse + teclado), movimiento WASD, giro (yaw) y el modo "ver obra" (encuadre + bloqueo + salida). `gallery.js` mantiene escena/luces/obras/sala y delega la cámara al controlador.

Interfaz pública:

```
const cam = new CameraController({
  camera,            // THREE.PerspectiveCamera
  domElement,        // renderer.domElement
  getColliders,      // () => Mesh[]  (paredes/paneles para colisión)
  hallBounds,        // { width, length } de this.hall
});

cam.update(dt);        // cada frame: aplica movimiento + giro + suavizado de mirada
cam.focusOn(artwork);  // encuadrar y bloquear la cámara en una obra
cam.release();         // salir de la obra (desbloquear) y mirar al frente
cam.reset();           // volver a la pose inicial
cam.dispose();         // quitar listeners
```

- El controlador es dueño de sus event listeners (mouse down/move/up, keydown/keyup) y los limpia en `dispose()`.
- El raycasting para hover/click de obras permanece en `gallery.js` (necesita la lista de obras); el controlador solo expone el estado `isViewLocked` / `isTweening` para que `gallery.js` sepa cuándo ignorar hover/click.

## Workstream 1 — Bugs de animación y paredes intermedias

**Problema raíz:** `selectArtwork()` mueve la cámara con `this.corridor?.width || 6` (→ asume pasillo de 6m que no existe) y solo contempla obras en paredes izquierda/derecha (desplazamiento en X). Las obras en paneles intermedios (miran ±X en x=±6) y en paredes norte/sur (miran ±Z) quedan mal encuadradas. Además `_updateSmoothLook()` usa un truco de espejo frágil, y `deselectArtwork()` usa el `corridor` inexistente de largo 80.

**Cambios:**

1. **Encuadre por normal (fix central).** `focusOn(artwork)` calcula:
   - `center` = centro world-space de la obra (`Box3().setFromObject(mesh).getCenter`).
   - `normal` = `artwork._normal` (fallback: derivar de `mesh.rotation.y`).
   - `distance` = distancia para encuadrar según tamaño de la obra y FOV vertical:
     `distance = (Math.max(w, h) * 0.5) / Math.tan((fov * DEG2RAD) / 2) * MARGIN` (MARGIN ≈ 1.15).
   - `dest` = `center + normal * distance`, a la altura de `center.y`.
   - **Clamp de seguridad:** recortar `distance` para que `dest` no atraviese el panel/pared opuesto ni salga de los límites de `hall` (dejar ≥ 0.35 m de guarda). Si el espacio disponible es menor que `distance`, usar el máximo posible.
   - Esto funciona **uniformemente** para paredes perimetrales, paneles intermedios y paredes norte/sur.

2. **Mirada simplificada.** Eliminar el truco de espejo de `_updateSmoothLook`. Bloqueado: `lookAt(center)` aplicado por slerp suave del quaternion. Durante el tween de posición (GSAP), en cada `onUpdate` reorientar hacia `center`.

3. **`release()` correcto.** Al salir, usar dimensiones reales de `hall` (no `corridor`). Comportamiento: mantener la posición Z/X actual, volver a altura de ojos (y=1.8) y mirar al frente; devolver el control de yaw libre sincronizando `targetYaw` con la orientación actual para que no haya salto.

4. **Limpieza de código muerto.** Eliminar `repositionArtworksAlongCorridor`, `updateCorridorMargins`, `createLightTracks` (vacío) y los campos `_corridor*`. Ajustar `resetCamera` para no depender de `corridor`.

**Criterios de aceptación (WS1):**
- Seleccionar cualquier obra (clic o Espacio) encuadra la cámara de frente a la obra, centrada, a una distancia que la muestra completa, **en las 4 paredes perimetrales y en ambos lados de los 2 paneles intermedios**.
- La cámara nunca atraviesa una pared/panel al encuadrar ni queda fuera de la sala.
- La transición de entrada y de salida es suave, sin giros bruscos ni "flips".
- Escape / "Salir de obra" devuelve al usuario a navegación libre mirando al frente, sin salto de orientación.

## Workstream 2 — Optimización

**Cambios:**

1. **Eliminar las luces de relleno por obra** (`_attachArtworkFillLight` y `_artFillLights`): no iluminan nada con material unlit. Quita 12 spotlights.
2. **Downscale de texturas de obra al cargar:** reescalar cada imagen a un máximo de 2048 px en el lado largo (vía canvas/`createImageBitmap`) antes de crear la textura; mantener mipmaps + anisotropía. Preserva calidad visible y reduce memoria de GPU.
3. **Compartir geometrías/materiales:** usar geometrías unitarias compartidas para marco y lienzo (una `BoxGeometry(1,1,0.1)` y una `PlaneGeometry(1,1)` reutilizadas, escaladas por instancia) en lugar de crear geometrías nuevas por obra. Material de marco compartido.
4. **Iluminación más ligera:** revisar la rejilla de point lights (9) + directional con sombras. Mantener lo mínimo para que los **marcos** (material lit) se vean bien; reducir tamaño de shadow map de la directional si no degrada la calidad, o limitar sombras a lo necesario.
5. **Dispose correcto:** liberar texturas, geometrías y materiales al desmontar la galería (método `dispose()` en `gallery.js`, llamado desde el cleanup de `App.jsx`).

**Criterios de aceptación (WS2):**
- La escena renderiza sin las 12 fill lights y las obras se ven igual de legibles (material unlit sin cambios).
- Las texturas grandes se cargan reescaladas (verificable: dimensiones de textura ≤ 2048 en el lado largo).
- No hay geometrías/materiales duplicados innecesarios por obra.
- Al desmontar/remontar la galería no crecen los recursos de GPU (sin fugas evidentes).
- FPS percibido más estable en escritorio; sin regresiones visuales.

## Workstream 3 — Controles

**Cambios:**

1. **Yaw independiente del framerate:** reemplazar el tope por frame `_yawMaxStep` por suavizado exponencial: `alpha = 1 - Math.exp(-K * dt)` y `yaw += (targetYaw - yaw) * alpha`. Ajustar `K` para respuesta suave y consistente a distintos framerates.
2. **Solo horizontal:** mantener pitch = 0 y `up = (0,1,0)`. Conservar amplitud 360° de yaw (normalizada a [-π, π]).
3. **Movimiento WASD:** ya es dt-based; añadir aceleración/desaceleración suave (rampa de velocidad) para arranque/frenado sin perder respuesta. Mantener normalización diagonal y clamp a límites de sala + colisión con paneles.
4. **Sensibilidad afinada** y sin estados "pegados": asegurar liberación correcta de drag/pointer al bloquear vista o al soltar fuera del canvas.

**Criterios de aceptación (WS3):**
- Girar arrastrando el mouse se siente suave y estable, con la misma sensación a 30 y a 144 fps.
- Se conserva el giro completo de 360° en horizontal; sin inclinación vertical.
- WASD arranca y frena de forma suave sin sensación de resbalón excesivo ni de input perdido.
- No quedan estados de arrastre "pegados" al seleccionar una obra o al soltar el botón fuera del canvas.

## Fuera de alcance (esta fase)

- Punto 4: rediseño del salón (mesas, paredes, techo, sistema de iluminación, alfombras). Se abordará después con su propio spec.
- Controles táctiles/móvil y pointer-lock.
- Migración a formatos de textura comprimida (KTX2/Basis).

## Riesgos / notas

- El clamp de distancia de encuadre debe considerar el panel sobre el que está la obra y el opuesto; validar en las 6 superficies (4 paredes + 2 paneles × 2 lados).
- Cambiar la iluminación de los marcos podría afectar su apariencia; validar visualmente antes/después.
- La extracción a `CameraController` debe preservar la integración con GSAP y con el gate de hover/click de `gallery.js`.
