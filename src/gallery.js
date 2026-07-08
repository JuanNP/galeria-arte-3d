import * as THREE from "three";
import { gsap } from "gsap";
import CameraController from "./CameraController.js";

export default class ArtGallery3D {
  constructor(options = {}) {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.currentRoom = "galeria";
    this.artworks = [];
    this.rooms = {};
    this.isLoading = true;
    this._spots = [];
    this._points = [];
    this._artFillLights = [];
    this.onRoomChange = options.onRoomChange || (() => {});
    this.onArtworkSelect = options.onArtworkSelect || (() => {});

    this.init();
  }

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

  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a1a);
    this.scene.fog = new THREE.Fog(0x0a0a1a, 50, 200);
  }

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

  setupRenderer() {
    const container = document.getElementById("canvas-container");
    if (!container) {
      throw new Error(
        "No se encontró el contenedor #canvas-container para el renderer"
      );
    }

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    const initialPR = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(initialPR);
    // Track current pixel ratio for dynamic resolution
    this._dyn = { pr: initialPR };
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.physicallyCorrectLights = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3; // a bit brighter whites
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    container.appendChild(this.renderer.domElement);

    window.addEventListener("resize", () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
  }

  // --- Build-time image URL map (so Vite places images in dist and returns BASE_URL-aware URLs)
  _imageURLMap = import.meta.glob("/assets/images/**/*", {
    eager: true,
    as: "url",
  });
  _imageURLMapAlt = import.meta.glob("/images/**/*", {
    eager: true,
    as: "url",
  });

  /**
   * Resolve an artwork image path to a final URL that already includes the correct BASE_URL.
   * Supports values like:
   *   "art_01.jpg"                     (filename only)
   *   "assets/images/art_01.jpg"       (relative path)
   *   "/assets/images/art_01.jpg"      (absolute from site root)
   *   "images/art_01.jpg" or "/images/art_01.jpg"
   * If not found in the glob maps, falls back to _resolveAssetUrl.
   */
  _resolveArtworkImage(path) {
    if (!path) return path;
    // If caller passed just a filename, try "/assets/images/" first, then "/images/"
    const onlyName = !path.includes("/");
    if (onlyName) {
      const p1 = "/assets/images/" + path;
      if (this._imageURLMap[p1]) return this._imageURLMap[p1];
      const p2 = "/images/" + path;
      if (this._imageURLMapAlt[p2]) return this._imageURLMapAlt[p2];
      return this._resolveAssetUrl(p1); // sensible default
    }

    // Normalize to absolute-with-leading-slash to match glob keys
    let abs = path.startsWith("/") ? path : "/" + path.replace(/^\/+/, "");
    // Prefer assets/images, otherwise images
    if (this._imageURLMap[abs]) return this._imageURLMap[abs];
    if (this._imageURLMapAlt[abs]) return this._imageURLMapAlt[abs];
    return this._resolveAssetUrl(path);
  }

  // Resolve asset URLs for Vite development and production
  _resolveAssetUrl(path) {
    if (!path) return path;
    if (/^(https?:)?\/\//.test(path) || /^data:/.test(path)) return path;
    const base = "/";
    if (path.startsWith("/")) return base + path.slice(1);
    return base + path;
  }

  // === Layout helpers =====================================================
  _makeSupportKey(s) {
    // Build a stable id for a support (wall/panel side), used to group anchors
    if (s.name) return `wall:${s.name}`;
    if (s.type === "panel") {
      // encode by orientation/position so both sides are unique
      if (s.z0 != null && s.z1 != null && s.x != null)
        return `panel:alongZ:x${s.x.toFixed(2)}`;
      if (s.x0 != null && s.x1 != null && s.z != null)
        return `panel:alongX:z${s.z.toFixed(2)}`;
    }
    return `support:${Math.random().toString(36).slice(2)}`; // fallback
  }

  _computeSupportNormal(rotY) {
    // Normal that points from the surface towards the room interior
    const n = new THREE.Vector3(0, 0, 1);
    n.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    return n.normalize();
  }

  _registerSupportSample(supportMap, s, samples, axis, start, end) {
    const key = this._makeSupportKey(s);
    if (!supportMap[key]) {
      supportMap[key] = {
        key,
        axis, // 'x' or 'z'
        start,
        end,
        rotY: s.rotY,
        normal: this._computeSupportNormal(s.rotY),
        list: [],
      };
    }
    const group = supportMap[key];
    for (const a of samples) {
      const coord = axis === "z" ? a.z : a.x;
      group.list.push({
        ...a,
        key,
        axis,
        coord,
        start,
        end,
        normal: group.normal,
      });
    }
  }

  _fitArtworkToCell(data) {
    // Rescale an artwork if its width would collide with neighbors on the same support
    const key = data._supportKey;
    if (!key || !this._supportsMap || !this._supportsMap[key]) return;
    const group = this._supportsMap[key];
    const arr = group.list.slice().sort((a, b) => a.coord - b.coord);
    const idx = arr.findIndex((a) => a === data._anchor);
    if (idx === -1) return;

    const pad = 0.45; // meters of breathing room on each side
    const leftEdge =
      idx > 0
        ? arr[idx - 1].coord + pad
        : Math.min(group.start, group.end) + pad;
    const rightEdge =
      idx < arr.length - 1
        ? arr[idx + 1].coord - pad
        : Math.max(group.start, group.end) - pad;
    const cellSpan = Math.max(0.2, Math.abs(rightEdge - leftEdge));

    // width of the painting (long side along the support axis)
    let w = Array.isArray(data.size) ? data.size[0] : 1.2;
    let h = Array.isArray(data.size) ? data.size[1] : 0.8;
    // Our geometries use width on X regardless; placement functions ensure alignment
    const long = w;

    if (long > cellSpan) {
      const s = Math.max(0.5, (cellSpan / long) * 0.9);
      w *= s;
      h *= s;
      data.size = [w, h];
      data._rescaled = true;
    }
  }

  // --- Helper: load image texture with sane defaults (sRGB, mipmaps, anisotropy) ---
  _loadArtworkTexture(url, onLoad, onError) {
    const loader = new THREE.TextureLoader();
    const resolvedUrl = this._resolveAssetUrl(url);

    loader.load(
      resolvedUrl,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = true;
        tex.anisotropy = Math.min(
          4,
          this.renderer.capabilities.getMaxAnisotropy()
        );
        tex.needsUpdate = true;
        onLoad?.(tex);
      },
      undefined,
      (err) => {
        console.error(`❌ Error cargando textura: ${url}`, err);
        console.error(`📍 URL resuelta: ${resolvedUrl}`);
        onError?.(err);
      }
    );
  }

  // Compute display size (meters) from image pixel size, respecting max/min and aspect
  _computeDisplaySize(imgW, imgH) {
    const MAX_W = 10; // meters (landscape width cap)
    const MAX_H = 10; // meters (portrait height cap)
    const MIN_W = 0.5; // avoid too tiny
    const MIN_H = 0.5;
    const aspect = Math.max(0.1, imgW / Math.max(1, imgH));

    let w, h;
    if (aspect >= 1) {
      // Landscape: width is the long side
      w = Math.min(MAX_W, 1.6); // base long side ~1.6m, capped by MAX_W
      h = w / aspect;
      if (h > MAX_H) {
        h = MAX_H;
        w = h * aspect;
      }
    } else {
      // Portrait: height is the long side
      h = Math.min(MAX_H, 1.6); // base long side ~1.6m, capped by MAX_H
      w = h * aspect;
      if (w > MAX_W) {
        w = MAX_W;
        h = w / aspect;
      }
    }
    // Clamp to mins
    w = Math.max(MIN_W, w);
    h = Math.max(MIN_H, h);

    // Scale up by 2x current size (overall 3.0x from original base) and clamp to max caps
    const SCALE = 3.0; // double current size (was 1.5x before)
    w = Math.min(MAX_W, w * SCALE);
    h = Math.min(MAX_H, h * SCALE);
    return { w, h };
  }

  // Apply width/height to canvas and frame (unit-sized geometries)
  _applyDisplaySize(frameMesh, canvasMesh, w, h) {
    const FRAME_PAD = 0.2; // 10cm border around the image
    if (canvasMesh) canvasMesh.scale.set(w, h, 1);
    if (frameMesh) frameMesh.scale.set(w + FRAME_PAD, h + FRAME_PAD, 1); // keep depth constant
  }

  // Attach a local spotlight to an artwork so the image is fully readable
  _attachArtworkFillLight(artworkGroup, w, h) {
    // Wide, soft spotlight placed slightly in front of the canvas, aimed back to its center.
    const spot = new THREE.SpotLight(0xffffff, 2.0, 3.5, Math.PI / 3, 0.7, 2);
    spot.castShadow = false; // this is just a fill; shadows come from ceiling lights
    spot.layers.enable(1); // only needs to light layer 1 (artworks)

    // Position in the artwork's LOCAL space (group rotates with the wall)
    const yMid = h * 0.15; // a bit above center to mimic gallery aiming
    spot.position.set(0, yMid, 0.55); // 55cm in front of the canvas

    // Create/attach target at the canvas center
    const target = new THREE.Object3D();
    target.position.set(0, yMid, 0.0);
    artworkGroup.add(target);
    spot.target = target;

    artworkGroup.add(spot);
    this._artFillLights.push(spot);
  }

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

  _updateSmoothLook() {
    if (!this._lookAtTarget) return;

    // When not locked, use camera's current rotation (mouse look)
    if (!this._isViewLocked) {
      // No need to update lookAtTarget when using mouse look
      // Camera rotation is handled directly in updateCameraRotation
      return;
    }

    // If locked, force both targets to the locked point
    if (this._isViewLocked && this._lockedTarget) {
      this._lookAtTarget.copy(this._lockedTarget);
      this._lookAtTargetDesired.copy(this._lockedTarget);
    }

    if (this._lookAtTargetDesired) {
      this._lookAtTarget.lerp(this._lookAtTargetDesired, this._targetLerp);
    }

    this._lookAtDummy.position.copy(this.camera.position);
    // Invert the look target: mirror target around the camera position
    const _invTarget = this.camera.position
      .clone()
      .multiplyScalar(2)
      .sub(this._lookAtTarget);
    this._lookAtDummy.lookAt(_invTarget);
    const desiredQuat = this._lookAtDummy.quaternion;
    this.camera.quaternion.slerp(desiredQuat, this._slerpFactor);
  }

  _updateMovement(dt) {
    if (this._isViewLocked) return;

    // Velocidades locales según teclas presionadas
    let forward = 0;
    let strafe = 0;

    if (this._keys.w) forward += 1;
    if (this._keys.s) forward -= 1;
    if (this._keys.a) strafe -= 1;
    if (this._keys.d) strafe += 1;

    if (forward === 0 && strafe === 0) return;

    // Normalizar movimiento para evitar velocidad diagonal más rápida
    const len = Math.hypot(forward, strafe);
    if (len > 0) {
      forward /= len;
      strafe /= len;
    }

    const moveSpeed = this._moveSpeed * dt;

    // Direcciones relativas a la vista actual (sin depender de yaw/Euler)
    const up = new THREE.Vector3(0, 1, 0);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.camera.quaternion
    );
    fwd.y = 0; // sin subir/bajar
    if (fwd.lengthSq() > 0) fwd.normalize();

    const right = new THREE.Vector3().crossVectors(fwd, up);
    if (right.lengthSq() > 0) right.normalize();

    // Desplazamiento global = (adelante/atrás) + (izq/der)
    const delta = new THREE.Vector3()
      .copy(fwd)
      .multiplyScalar(forward * moveSpeed)
      .add(right.multiplyScalar(strafe * moveSpeed));

    this.camera.position.add(delta);
    this.camera.position.y = 1.8;

    // Limitar posición dentro de la sala
    const w = this.hall?.width || 24;
    const l = this.hall?.length || 24;
    const safe = 0.6;
    this.camera.position.x = THREE.MathUtils.clamp(
      this.camera.position.x,
      -w / 2 + safe,
      w / 2 - safe
    );
    this.camera.position.z = THREE.MathUtils.clamp(
      this.camera.position.z,
      -l / 2 + safe,
      l / 2 - safe
    );

    // Detección básica de colisión contra paredes y paneles
    const cam = this.camera.position;
    const collided = this._colliders?.some((m) => {
      const b = new THREE.Box3().setFromObject(m);
      const margin = 0.3;
      b.min.x -= margin;
      b.min.z -= margin;
      b.max.x += margin;
      b.max.z += margin;
      return (
        cam.x > b.min.x && cam.x < b.max.x && cam.z > b.min.z && cam.z < b.max.z
      );
    });
    if (collided) {
      this.camera.position.sub(delta);
      this.camera.position.y = 1.8;
    }
  }

  _dynamicResTick(ms) {
    if (!this._dyn) return;
    // target ~60fps -> 16.7ms; adjust gently within [1.0, 1.5]
    if (ms > 20 && this._dyn.pr > 1.0) {
      this._dyn.pr = Math.max(1.0, this._dyn.pr - 0.05);
      this.renderer.setPixelRatio(this._dyn.pr);
    } else if (ms < 13 && this._dyn.pr < 1.5) {
      this._dyn.pr = Math.min(1.5, this._dyn.pr + 0.05);
      this.renderer.setPixelRatio(this._dyn.pr);
    }
  }

  setupLights() {
    // Soft ambient fill replaced by hemisphere to keep white walls balanced
    const hemi = new THREE.HemisphereLight(0xffffff, 0x2b2b2b, 0.5);
    hemi.layers.enable(1); // affect artworks on layer 1
    this.scene.add(hemi);

    // Top-down directional to keep lighting symmetric left/right and preserve shadows
    const directionalLight = new THREE.DirectionalLight(0xfffbf0, 0.7); // slight warm white, softer to let spots read
    directionalLight.layers.enable(1); // affect artworks on layer 1
    directionalLight.position.set(0, 12, 6); // slightly forward, centered in X
    directionalLight.target.position.set(0, 0, 0);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 80;
    directionalLight.shadow.camera.left = -24;
    directionalLight.shadow.camera.right = 24;
    directionalLight.shadow.camera.top = 24;
    directionalLight.shadow.camera.bottom = -24;
    directionalLight.shadow.bias = -0.0002; // reduce acne/banding
    this.scene.add(directionalLight);
    this.scene.add(directionalLight.target);
    // Rejilla de puntos suaves para la sala
    this._points = [];
    const w = this.hall?.width || 24;
    const l = this.hall?.length || 24;
    const step = 8;
    for (let x = -w / 2 + step; x <= w / 2 - step; x += step) {
      for (let z = -l / 2 + step; z <= l / 2 - step; z += step) {
        const p = new THREE.PointLight(0xffffff, 0.6, 28);
        p.position.set(x, (this.hall?.height || 6) - 0.7, z);
        p.castShadow = false;
        this.scene.add(p);
        this._points.push(p);
      }
    }
  }

  generateConcreteTexture(size = 256) {
    // Genera una textura procedural de madera (tablones + vetas + ruido)
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    // Paleta madera (tonos cálidos)
    const baseHue = 30 + Math.random() * 10; // dorado/anaranjado
    const base = `hsl(${baseHue}, 45%, 55%)`;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    // Dibujar tablones en dirección Y (verticales en textura)
    const plankCount = 6 + ((Math.random() * 3) | 0);
    const plankW = size / plankCount;
    for (let i = 0; i < plankCount; i++) {
      const x0 = i * plankW;
      // sombreado sutil por tablón
      const grad = ctx.createLinearGradient(x0, 0, x0 + plankW, 0);
      grad.addColorStop(0, `hsla(${baseHue}, 45%, 46%, 0.25)`);
      grad.addColorStop(0.5, `hsla(${baseHue}, 45%, 58%, 0.15)`);
      grad.addColorStop(1, `hsla(${baseHue}, 45%, 46%, 0.25)`);
      ctx.fillStyle = grad;
      ctx.fillRect(x0, 0, plankW, size);

      // líneas de borde del tablón
      ctx.strokeStyle = `hsla(${baseHue}, 35%, 30%, 0.35)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x0), 0);
      ctx.lineTo(Math.round(x0), size);
      ctx.stroke();
    }

    // Vetas curvas: múltiples trazos semitransparentes con ruido
    const grainLayers = 28;
    for (let g = 0; g < grainLayers; g++) {
      const yStart = Math.random() * size;
      const amp = 2 + Math.random() * 6; // amplitud
      const freq = 0.015 + Math.random() * 0.02; // frecuencia
      const tilt = (Math.random() - 0.5) * 0.2; // leve inclinación
      ctx.strokeStyle = `hsla(${baseHue}, 35%, ${
        (38 + Math.random() * 8) | 0
      }%, ${0.06 + Math.random() * 0.06})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= size; x++) {
        const y =
          yStart + Math.sin(x * freq + g * 0.35) * amp + x * tilt * 0.02;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // "Nudos" de madera: óvalos suaves aleatorios
    const knots = 6 + ((Math.random() * 6) | 0);
    for (let k = 0; k < knots; k++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const rx = 5 + Math.random() * 12;
      const ry = 3 + Math.random() * 8;
      const grd = ctx.createRadialGradient(x, y, 1, x, y, Math.max(rx, ry));
      grd.addColorStop(0, `hsla(${baseHue}, 40%, 28%, 0.25)`);
      grd.addColorStop(1, `hsla(${baseHue}, 40%, 28%, 0)`);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ruido fino para romper la uniformidad
    const density = size * size * 0.02;
    for (let i = 0; i < density; i++) {
      const x = (Math.random() * size) | 0;
      const y = (Math.random() * size) | 0;
      const a = 0.03 + Math.random() * 0.03;
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.fillRect(x, y, 1, 1);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(
      4,
      this.renderer.capabilities.getMaxAnisotropy()
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  generateWhiteNoiseTexture(size = 256, base = "#ffffff", noiseAlpha = 0.05) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < size * size * 0.02; i++) {
      const x = (Math.random() * size) | 0;
      const y = (Math.random() * size) | 0;
      const a = noiseAlpha * Math.random();
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.fillRect(x, y, 1, 1);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(
      4,
      this.renderer.capabilities.getMaxAnisotropy()
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  generateArtworkTexture(width = 256, height = 256) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const grad = ctx.createLinearGradient(0, 0, width, height);
    const hue = Math.floor(Math.random() * 360);
    grad.addColorStop(0, `hsl(${hue}, 70%, 60%)`);
    grad.addColorStop(1, `hsl(${(hue + 40) % 360}, 70%, 40%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    const numShapes = 6 + Math.floor(Math.random() * 6);
    for (let i = 0; i < numShapes; i++) {
      ctx.globalAlpha = 0.2 + Math.random() * 0.5;
      ctx.fillStyle = `hsl(${(hue + i * 20) % 360}, 80%, ${30 + i * 5}%)`;
      const r = 10 + Math.random() * 60;
      const x = Math.random() * width;
      const y = Math.random() * height;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = Math.min(
      4,
      this.renderer.capabilities.getMaxAnisotropy()
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  createRooms() {
    this.rooms.galeria = this.createHall();
  }

  // Nueva sala amplia con paneles interiores
  createHall() {
    const group = new THREE.Group();
    const width = 34;
    const length = 34;
    const height = 6;
    const wallThickness = 0.25;
    this.hall = { width, length, height, wallThickness };
    this._colliders = [];
    this._supports = [];

    // Piso
    const floorGeometry = new THREE.PlaneGeometry(width, length);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0.0,
    });

    // Cargar textura de piso
    const floorTextureLoader = new THREE.TextureLoader();
    floorTextureLoader.load(
      "/galeria-arte-3d/assets/textures/piso.jpg",
      (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(width / 4, length / 4); // Ajustar repetición según el tamaño de la sala
        texture.anisotropy = Math.min(
          4,
          this.renderer.capabilities.getMaxAnisotropy()
        );
        texture.colorSpace = THREE.SRGBColorSpace;
        floorMaterial.map = texture;
        floorMaterial.needsUpdate = true;
      },
      undefined,
      (error) => {
        console.warn(
          "No se pudo cargar la textura del piso, usando textura generada:",
          error
        );
        // Fallback a textura generada si falla la carga
        const concreteMap = this.generateConcreteTexture(512);
        concreteMap.repeat.set(width / 6, length / 20);
        floorMaterial.map = concreteMap;
        floorMaterial.needsUpdate = true;
      }
    );
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.001;
    floor.receiveShadow = true;
    group.add(floor);

    // Techo
    const ceilingGeometry = new THREE.PlaneGeometry(width, length);
    const ceilingMap = this.generateWhiteNoiseTexture(256, "#ffffff", 0.03);
    ceilingMap.repeat.set(width / 6, length / 20);
    const ceilingMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: ceilingMap,
      roughness: 0.9,
      metalness: 0.0,
    });
    const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, height + 0.001, 0);
    group.add(ceiling);

    // Paredes perimetrales
    const sideWallGeometry = new THREE.BoxGeometry(
      wallThickness,
      height,
      length
    );
    const wallMap = this.generateWhiteNoiseTexture(256, "#ffffff", 0.03);
    wallMap.repeat.set(length / 20, height / 4);
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: wallMap,
      roughness: 0.85,
      metalness: 0.0,
    });
    const leftWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
    leftWall.position.set(-width / 2, height / 2, 0);
    leftWall.castShadow = true;
    leftWall.receiveShadow = true;
    group.add(leftWall);
    const rightWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
    rightWall.position.set(width / 2, height / 2, 0);
    rightWall.castShadow = true;
    rightWall.receiveShadow = true;
    group.add(rightWall);

    // Paredes norte/sur (sin hueco: sur continuo)
    const endWallGeometry = new THREE.BoxGeometry(width, height, wallThickness);
    const northWall = new THREE.Mesh(endWallGeometry, wallMaterial);
    northWall.position.set(0, height / 2, -length / 2);
    northWall.castShadow = true;
    northWall.receiveShadow = true;
    group.add(northWall);

    const southWall = new THREE.Mesh(endWallGeometry, wallMaterial);
    southWall.position.set(0, height / 2, length / 2);
    southWall.castShadow = true;
    southWall.receiveShadow = true;
    group.add(southWall);

    // Paneles interiores
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.generateWhiteNoiseTexture(256, "#ffffff", 0.02),
      roughness: 0.85,
      metalness: 0.0,
    });
    const mkPanel = (sx, sz, len, alongZ = true) => {
      const geo = alongZ
        ? new THREE.BoxGeometry(0.2, height - 0.5, len)
        : new THREE.BoxGeometry(len, height - 0.5, 0.2);
      const m = new THREE.Mesh(geo, panelMat);
      m.position.set(sx, (height - 0.5) / 2, sz);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      this._colliders.push(m);
      // Registrar superficies para colocación de obras (ambos lados)
      if (alongZ) {
        const half = len / 2;
        this._supports.push({
          type: "panel",
          side: "left",
          x: sx - 0.11,
          z0: sz - half,
          z1: sz + half,
          rotY: Math.PI / 2,
        });
        this._supports.push({
          type: "panel",
          side: "right",
          x: sx + 0.11,
          z0: sz - half,
          z1: sz + half,
          rotY: -Math.PI / 2,
        });
      } else {
        const half = len / 2;
        this._supports.push({
          type: "panel",
          side: "front",
          z: sz - 0.11,
          x0: sx - half,
          x1: sx + half,
          rotY: 0,
        });
        this._supports.push({
          type: "panel",
          side: "back",
          z: sz + 0.11,
          x0: sx - half,
          x1: sx + half,
          rotY: Math.PI,
        });
      }
      return m;
    };

    // Dos paneles largos centrados y paralelos
    mkPanel(-6, 0, 16, true);
    mkPanel(6, 0, 16, true);

    // Añadir paredes como colisionadores
    [leftWall, rightWall, northWall, southWall].forEach((w) =>
      this._colliders.push(w)
    );

    // Registrar soportes perimetrales (excluyendo hueco sur)
    const margin = 1.0;
    // Oeste (x negativo) mirando +X
    this._supports.push({
      type: "wall",
      name: "west",
      x: -width / 2 + 0.11,
      z0: -length / 2 + margin,
      z1: length / 2 - margin,
      rotY: Math.PI / 2,
    });
    // Este (x positivo) mirando -X
    this._supports.push({
      type: "wall",
      name: "east",
      x: width / 2 - 0.11,
      z0: -length / 2 + margin,
      z1: length / 2 - margin,
      rotY: -Math.PI / 2,
    });
    // Norte (z negativo) mirando +Z
    this._supports.push({
      type: "wall",
      name: "north",
      z: -length / 2 + 0.11,
      x0: -width / 2 + margin,
      x1: width / 2 - margin,
      rotY: 0,
    });
    // Sur (z positivo) continuo (sin hueco)
    this._supports.push({
      type: "wall",
      name: "south",
      z: length / 2 - 0.11,
      x0: -width / 2 + margin,
      x1: width / 2 - margin,
      rotY: Math.PI,
    });

    this.scene.add(group);
    return group;
  }

  createLightTracks(parent, corridorLength, corridorWidth, wallHeight) {
    // No riel lineal; en sala usaremos rejilla de focos desde setupLights/refresh
  }

  rebuildArtworkSpots() {
    // Remove existing artwork spots
    for (const s of this._spots) {
      if (s.target && s.target.parent) s.target.parent.remove(s.target);
      if (s.parent) s.parent.remove(s);
    }
    this._spots = [];

    const wallHeight = this.hall?.height || this.corridor?.wallHeight || 6;

    // Create one spotlight per artwork, positioned directly above its wall, aimed at the artwork center
    for (const a of this.artworks) {
      if (!a || !a.mesh) continue;
      const center = new THREE.Vector3();
      new THREE.Box3().setFromObject(a.mesh).getCenter(center);
      const y = wallHeight - 0.3;
      const spot = new THREE.SpotLight(0xfff1e0, 2.2, 18, Math.PI / 6, 0.5, 2);
      spot.position.set(center.x, y, center.z);
      // Light affects both default (0) and artworks (1) layers
      spot.layers.enable(1);

      // Target: artwork center
      spot.target.position.set(center.x, center.y, center.z);

      spot.castShadow = true;
      spot.shadow.mapSize.set(2048, 2048);
      spot.shadow.bias = -0.00018;
      spot.shadow.camera.near = 0.1;
      spot.shadow.camera.far = 30;
      spot.shadow.focus = 1;

      this.scene.add(spot);
      this.scene.add(spot.target);
      this._spots.push(spot);
    }
  }

  repositionArtworksAlongCorridor() {
    // Recalcula Z de todas las obras según los márgenes actuales sin cambiar su lado (X) ni altura (Y)
    if (!this.artworks || !this.artworks.length) return;
    const N = this.artworks.length;
    const corridorWidth = this.corridor?.width || 6;
    const corridorLength = this.corridor?.length || 80;
    const halfLen = corridorLength / 2;
    const startMargin = this._corridorStartMargin;
    const endMargin = this._corridorEndMargin;
    const frameDepth = 0.1;
    const gap = 0.12;
    const xInner = corridorWidth / 2 - (frameDepth + gap);
    const startZ = -halfLen + startMargin;
    const usableLen = corridorLength - startMargin - endMargin;
    const spacingZ = N > 1 ? usableLen / (N - 1) : 0;

    this.artworks.forEach((a, i) => {
      if (!a || !a.mesh) return;
      const sideRight = i % 2 === 0;
      const xOffset = sideRight ? xInner : -xInner;
      const z = startZ + i * spacingZ;

      // Mantener Y actual
      const y = a.mesh.position.y;
      a.side = sideRight ? "right" : "left";
      a.position = [xOffset, y, z];
      a.mesh.position.set(xOffset, y, z);
      a.mesh.rotation.y = sideRight ? -Math.PI / 2 : Math.PI / 2;
    });

    // Reajustar focos si se usan por-obra
    if (this._spots && this._spots.length) this.rebuildArtworkSpots();
  }

  updateCorridorMargins(start, end) {
    if (typeof start === "number")
      this._corridorStartMargin = Math.max(0, start);
    if (typeof end === "number") this._corridorEndMargin = Math.max(0, end);
    this.repositionArtworksAlongCorridor();

    // Asegurar que la cámara respeta los nuevos límites inmediatamente
    const corridorLength = this.corridor?.length || 80;
    const halfLen = corridorLength / 2;
    const startZ = -halfLen + this._corridorStartMargin;
    const endZ = halfLen - this._corridorEndMargin;

    const minZ = Math.max(
      -halfLen + this._corridorWallSafe,
      startZ - this._corridorEndViewLead
    );
    const maxZ = Math.min(
      halfLen - this._corridorWallSafe,
      endZ + this._corridorStartViewLead
    );
    this.camera.position.z = THREE.MathUtils.clamp(
      this.camera.position.z,
      minZ,
      maxZ
    );
  }
  // Public API: rebuild per-artwork spotlights after adding/removing artworks at runtime
  refreshLighting() {
    this.rebuildArtworkSpots();
  }
  _updateCulling() {
    const ACTIVE_Z = 24; // ventana visible ±12 m
    const cz = this.camera.position.z;

    // Obras
    for (let i = 0; i < this.artworks.length; i++) {
      const a = this.artworks[i];
      if (!a || !a.mesh) continue;
      const vis = Math.abs(a.mesh.position.z - cz) < ACTIVE_Z;
      if (a.mesh.visible !== vis) a.mesh.visible = vis;
    }

    // Luz ambiental (PointLights)
    for (const p of this._points) {
      const vis = Math.abs(p.position.z - cz) < ACTIVE_Z + 6;
      if (p.visible !== vis) p.visible = vis;
    }

    // Spots
    for (const s of this._spots) {
      const vis = Math.abs(s.position.z - cz) < ACTIVE_Z;
      if (s.visible !== vis) s.visible = vis;
    }
  }

  async createArtworks() {
    try {
      const base = (import.meta.env && import.meta.env.BASE_URL) || "/";
      const url = base + "artworks.json";
      const res = await fetch(url);
      res.status === 404 && (res = await fetch(base + "assets/artworks.json"));
      const artworksData = await res.json();

      if (!artworksData) {
        console.error("💥 No se pudo cargar artworks.json desde ninguna ruta");
        throw new Error("No se pudo cargar artworks.json");
      }

      // --- Build supportsMap structure for layout ---
      const supportsMap = {};
      // Helpers de muestreo uniforme
      const sampleAlongZ = (x, z0, z1, rotY, count, pad = 0.6, s) => {
        const res = [];
        const span = Math.abs(z1 - z0) - pad * 2;
        if (span > 0) {
          const dir = z1 > z0 ? 1 : -1;
          if (count <= 1) {
            res.push({ x, z: z0 + dir * (Math.abs(span) / 2 + pad), rotY });
          } else {
            for (let i = 0; i < count; i++) {
              const t = count === 1 ? 0.5 : i / (count - 1);
              const z = z0 + dir * pad + dir * (t * span);
              res.push({ x, z, rotY });
            }
          }
        }
        // Register in supportsMap (even if res is empty to ensure group exists)
        this._registerSupportSample(supportsMap, s, res, "z", z0, z1);
        return res;
      };
      const sampleAlongX = (z, x0, x1, rotY, count, pad = 0.6, s) => {
        const res = [];
        const span = Math.abs(x1 - x0) - pad * 2;
        if (span > 0) {
          const dir = x1 > x0 ? 1 : -1;
          if (count <= 1) {
            res.push({ x: x0 + dir * (Math.abs(span) / 2 + pad), z, rotY });
          } else {
            for (let i = 0; i < count; i++) {
              const t = count === 1 ? 0.5 : i / (count - 1);
              const x = x0 + dir * pad + dir * (t * span);
              res.push({ x, z, rotY });
            }
          }
        }
        // Register in supportsMap
        this._registerSupportSample(supportsMap, s, res, "x", x0, x1);
        return res;
      };

      // === Sample anchors for every support (walls + both sides of panels) ===
      const TARGET_SPACING = 10.0; // meters between artworks along a support
      const PAD = 0.6; // breathing room near ends
      for (const s of this._supports) {
        if (s.z0 != null && s.z1 != null && s.x != null) {
          const span = Math.max(0, Math.abs(s.z1 - s.z0) - PAD * 2);
          const count = Math.max(1, Math.round(span / TARGET_SPACING));
          sampleAlongZ(s.x, s.z0, s.z1, s.rotY, count, PAD, s);
        } else if (s.x0 != null && s.x1 != null && s.z != null) {
          const span = Math.max(0, Math.abs(s.x1 - s.x0) - PAD * 2);
          const count = Math.max(1, Math.round(span / TARGET_SPACING));
          sampleAlongX(s.z, s.x0, s.x1, s.rotY, count, PAD, s);
        }
      }

      // === Distribución equitativa entre TODAS las superficies (paredes perimetrales + cada lado de paneles) ===
      this._supportsMap = supportsMap; // Save for fitting / cell sizing

      // === Center anchors within each support (CSS justify-content: space-around style) ===
      for (const key in supportsMap) {
        const group = supportsMap[key];
        const list = group.list;
        if (!list || list.length < 2) continue;

        // Determine axis range
        const min = Math.min(group.start, group.end);
        const max = Math.max(group.start, group.end);
        const totalSpan = Math.abs(max - min);
        const count = list.length;

        // Calculate spacing with equal gaps and centered start offset
        const space = totalSpan / (count + 1);

        for (let i = 0; i < count; i++) {
          const posCoord = min + space * (i + 1);
          if (group.axis === "z") {
            list[i].z =
              group.start < group.end ? posCoord : max - space * (i + 1);
          } else if (group.axis === "x") {
            list[i].x =
              group.start < group.end ? posCoord : max - space * (i + 1);
          }
        }
      }

      // Construir buckets para *cada* soporte (pared o lado de panel) con sus anclajes muestreados.
      // El muestreo ya se realizó con sampleAlongZ/sampleAlongX al llenar supportsMap.
      // Mantener orden estable: primero paredes perimetrales (west,east,north,south), luego paneles por clave.
      const allGroups = [];
      const orderWalls = ["west", "east", "north", "south"];
      for (const wname of orderWalls) {
        const g = Object.values(supportsMap).find(
          (gg) => gg.key === `wall:${wname}`
        );
        if (g) allGroups.push({ name: g.key, list: g.list.slice() });
      }
      // Añadir el resto (paneles y cualquier otro) en orden alfabético de clave para estabilidad.
      const otherGroups = Object.values(supportsMap)
        .filter(
          (g) =>
            !g.key.startsWith("wall:") ||
            !orderWalls.includes(g.key.split(":")[1])
        )
        .sort((a, b) => a.key.localeCompare(b.key));
      for (const g of otherGroups) {
        allGroups.push({ name: g.key, list: g.list.slice() });
      }

      // Helper round‑robin que reparte equitativamente respetando la capacidad de cada bucket.
      const roundRobinTake = (buckets, count) => {
        const out = [];
        // Copia de trabajo mutable
        const work = buckets.map((b) => ({
          name: b.name,
          list: b.list.slice(),
        }));
        let i = 0;
        while (out.length < count) {
          const alive = work.filter((b) => b.list.length > 0);
          if (!alive.length) break;
          const b = alive[i % alive.length];
          const a = b.list.shift();
          if (a) out.push(a);
          i++;
        }
        return out;
      };

      const totalArtworks = artworksData.length;
      // Repartir sobre todas las superficies por turnos.
      let anchors = roundRobinTake(allGroups, totalArtworks);

      // Si por capacidad no alcanza, hacer un segundo pase sobre cualquier soporte que aún tenga huecos.
      if (anchors.length < totalArtworks) {
        const anyBuckets = Object.values(supportsMap).map((g) => ({
          name: g.key,
          list: g.list.slice(),
        }));
        const remaining = totalArtworks - anchors.length;
        anchors = anchors.concat(roundRobinTake(anyBuckets, remaining));
      }

      // Usar la lista final de anclajes en el mismo orden que se generó arriba
      const N = artworksData.length;
      for (let i = 0; i < N; i++) {
        const data = artworksData[i];
        const a = anchors[i % anchors.length] || { x: 0, z: 0, rotY: 0 };
        const y = 2;
        const artworkData = {
          ...data,
          image: this._resolveArtworkImage(data.image),
          position: [a.x, y, a.z],
          rotationY: a.rotY,
          _supportKey: a.key,
          _anchor: a,
          _normal: a.normal,
        };
        this.createArtwork(artworkData, i);
      }
    } catch (err) {
      console.error("Error cargando artworks.json:", err);
    }
  }

  createArtwork(data, index) {
    const artworkGroup = new THREE.Group();
    // Start with unit geometry; final size will be applied via scale
    const frameGeometry = new THREE.BoxGeometry(1, 1, 0.1);
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.5,
      metalness: 0.05,
    });
    const frame = new THREE.Mesh(frameGeometry, frameMaterial);
    frame.castShadow = true;
    artworkGroup.add(frame);

    const canvasGeometry = new THREE.PlaneGeometry(1, 1);
    const canvasMaterial = this._artUnlit
      ? new THREE.MeshBasicMaterial({
          // Multiply texture by this color to dim or brighten in unlit mode
          color: new THREE.Color().setScalar(this._artUnlitBrightness),
        })
      : new THREE.MeshStandardMaterial({
          roughness: 1.0,
          metalness: 0.0,
        });

    // Prefer custom image if provided; otherwise use generated textures with LOD
    let canvas = null;
    if (data.image) {
      const imgUrl = this._resolveArtworkImage(data.image);
      canvas = new THREE.Mesh(canvasGeometry, canvasMaterial);
      canvas.position.z = 0.06;
      canvas.castShadow = false; // do not let canvas be affected by light/shadows
      artworkGroup.add(canvas);
      this._loadArtworkTexture(imgUrl, (texture) => {
        canvasMaterial.map = texture;
        canvasMaterial.needsUpdate = true;
        if (!this._artUnlit) {
          // Lit pipeline: gentle self-illumination for readability
          canvasMaterial.emissive = new THREE.Color(0x111111);
          canvasMaterial.emissiveMap = texture;
          canvasMaterial.emissiveIntensity = this._artEmissiveBoost;
          canvasMaterial.roughness = 0.3;
          canvasMaterial.metalness = 0.0;
        }
        data._hasCustomImage = true;
        data._canvasMaterial = canvasMaterial;
        // Size the artwork to preserve the image aspect ratio with safe caps
        const { w, h } = this._computeDisplaySize(
          texture.image?.naturalWidth || texture.image?.width || 1024,
          texture.image?.naturalHeight || texture.image?.height || 1024
        );
        data.size = [w, h];
        // Fit to cell if needed
        this._fitArtworkToCell(data);
        // Apply (possibly rescaled) size
        this._applyDisplaySize(frame, canvas, data.size[0], data.size[1]);
        // Place the artwork so the bottom sits at a constant margin above the floor
        const [x0, , z0] = data.position;
        const newY = this._artBottomMargin + data.size[1] * 0.5;
        data.position = [x0, newY, z0];
        artworkGroup.position.y = newY;
        // Local fill light so the artwork reads as fully illuminated
        this._attachArtworkFillLight(artworkGroup, data.size[0], data.size[1]);
      });
      // (Optional safety) Ensure canvases do NOT receive shadow maps from frames/walls
      canvas.receiveShadow = false; // keep image clean from shadow maps
    } else {
      const artMapLow = this.generateArtworkTexture(256, 256);
      const artMapHigh = this.generateArtworkTexture(512, 512);
      canvasMaterial.map = artMapLow;
      canvasMaterial.needsUpdate = true;
      if (!this._artUnlit) {
        // Self-illumination for generated artworks (lit mode only)
        canvasMaterial.emissive = new THREE.Color(0x111111);
        canvasMaterial.emissiveMap = artMapLow;
        canvasMaterial.emissiveIntensity = this._artEmissiveBoost;
        canvasMaterial.roughness = 0.3;
        canvasMaterial.metalness = 0.0;
      }
      data._artMapLow = artMapLow;
      data._artMapHigh = artMapHigh;
      data._canvasMaterial = canvasMaterial;
      data._currentLOD = "low";
      canvas = new THREE.Mesh(canvasGeometry, canvasMaterial);
      canvas.position.z = 0.06;
      canvas.castShadow = false;
      artworkGroup.add(canvas);
      // (Optional safety) Ensure canvases do NOT receive shadow maps from frames/walls
      canvas.receiveShadow = false; // keep image clean from shadow maps
      // Apply default or provided size
      let w0 = Array.isArray(data.size) ? data.size[0] : 1.2;
      let h0 = Array.isArray(data.size) ? data.size[1] : 0.8;
      // Double current size (overall 3.0x from original base), with generous caps
      w0 = Math.min(10, w0 * 3.0);
      h0 = Math.min(10, h0 * 3.0);
      data.size = [w0, h0];
      // Fit to cell if needed
      this._fitArtworkToCell(data);
      // Apply (possibly rescaled) size
      this._applyDisplaySize(frame, canvas, data.size[0], data.size[1]);
      // Place the artwork so the bottom sits at a constant margin above the floor
      const [x0, , z0] = data.position;
      const newY = this._artBottomMargin + data.size[1] * 0.5;
      data.position = [x0, newY, z0];
      artworkGroup.position.y = newY;
      // Local fill light so the artwork reads as fully illuminated
      this._attachArtworkFillLight(artworkGroup, data.size[0], data.size[1]);
    }

    data.mesh = artworkGroup;
    data.index = index;
    this.artworks.push(data);

    const [x, y, z] = data.position;
    // Place the group with a tiny push along the wall/panel normal to avoid z-fighting
    let px = x,
      pz = z;
    if (data._normal) {
      px += data._normal.x * 0.012;
      pz += data._normal.z * 0.012;
    }
    artworkGroup.position.set(px, y, pz);
    if (typeof data.rotationY === "number") {
      artworkGroup.rotation.y = data.rotationY;
    } else if (data.side === "left") {
      artworkGroup.rotation.y = Math.PI / 2;
    } else if (data.side === "right") {
      artworkGroup.rotation.y = -Math.PI / 2;
    }

    this.scene.add(artworkGroup);
    this.addArtworkInteraction(artworkGroup, data);
    artworkGroup.traverse((o) => o.layers.set(1));
  }
  _updateLOD() {
    const cameraZ = this.camera.position.z;
    for (let i = 0; i < this.artworks.length; i++) {
      const a = this.artworks[i];
      if (!a) continue; // guard: undefined slot
      if (!a.mesh) continue; // guard: mesh not built yet
      if (!a._canvasMaterial) continue; // guard: material not ready
      if (!a.mesh.visible) continue; // culled; skip
      if (a._hasCustomImage) continue; // single LOD image

      const dist = Math.abs(a.mesh.position.z - cameraZ);
      const wantHigh = dist < 15;
      const desired = wantHigh ? "high" : "low";
      if (a._currentLOD === desired) continue;

      const tex = wantHigh ? a._artMapHigh : a._artMapLow;
      if (tex) {
        a._canvasMaterial.map = tex;
        a._canvasMaterial.needsUpdate = true;
        a._currentLOD = desired;
      }
    }
  }

  addArtworkInteraction(artworkGroup, data) {}

  highlightArtwork(artworkGroup, highlight) {
    const scale = highlight ? 1.1 : 1.0;
    const intensity = highlight ? 1.2 : 1.0;
    gsap.to(artworkGroup.scale, {
      x: scale,
      y: scale,
      z: scale,
      duration: 0.3,
      ease: "power2.out",
    });
    artworkGroup.children.forEach((child) => {
      if (child.material) {
        gsap.to(child.material, {
          opacity: intensity,
          duration: 0.3,
          ease: "power2.out",
        });
      }
    });
  }

  selectNearestArtwork() {
    if (!this.artworks.length) return;
    // Ray from camera forward to find the first artwork in view
    const dir = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(this.camera.quaternion)
      .normalize();
    const raycaster = new THREE.Raycaster(
      this.camera.position.clone(),
      dir,
      0.1,
      50
    );
    const meshes = this.artworks.map((a) => a && a.mesh).filter(Boolean);
    const hits = raycaster.intersectObjects(meshes, true);
    if (hits.length) {
      const group = hits[0].object.parent;
      const art = this.artworks.find((a) => a.mesh === group);
      if (art) return this.selectArtwork(art);
    }
    // Fallback: pick the closest artwork ahead in Z
    const ahead = this.artworks
      .filter((a) => a && a.mesh)
      .map((a) => ({ a, dz: a.mesh.position.z - this.camera.position.z }))
      .filter((o) => o.dz > -2) // prefer in front or slightly behind
      .sort((p, q) => Math.abs(p.dz) - Math.abs(q.dz));
    if (ahead.length) this.selectArtwork(ahead[0].a);
  }

  selectArtwork(artwork) {
    if (!artwork || !artwork.mesh) return;
    this.onArtworkSelect?.(artwork);
    this.camControls.focusOn(artwork);
  }

  deselectArtwork() {
    this.selectedArtwork = null;
    this.camControls?.release();
  }

  setupEventListeners() {}

  changeRoom(roomName) {
    this.currentRoom = roomName;
    this.onRoomChange?.({
      key: roomName,
      name: this.getRoomDisplayName(roomName),
      description: this.getRoomDescription(roomName),
    });
    const roomPosition = this.getRoomPosition(roomName);
    gsap.to(this.camera.position, {
      x: roomPosition.x,
      y: roomPosition.y + 2,
      z: roomPosition.z + 5,
      duration: 2,
      ease: "power2.inOut",
    });
  }

  getRoomDisplayName(roomName) {
    const names = { galeria: "Galería" };
    return names[roomName] || roomName;
  }

  getRoomDescription(roomName) {
    const descriptions = {
      galeria: "Pasillo de galería con paredes blancas y piso gris.",
    };
    return descriptions[roomName] || "";
  }

  getRoomPosition(roomName) {
    const positions = { galeria: { x: 0, y: 0, z: 0 } };
    return positions[roomName] || { x: 0, y: 0, z: 0 };
  }

  // Public API: reset camera to its initial pose
  resetCamera() {
    if (!this.camControls) return;
    this.camControls.reset();
    this.onArtworkSelect?.(null);
  }

  hideLoadingScreen() {
    const loadingScreen = document.getElementById("loading-screen");
    if (!loadingScreen) {
      // No hay overlay clásico: marcar como no-cargando igualmente
      this.isLoading = false;
      document.getElementById("app")?.classList.add("fade-in");
      return;
    }
    loadingScreen.style.opacity = "0";
    setTimeout(() => {
      loadingScreen.style.display = "none";
      this.isLoading = false;
      document.getElementById("app")?.classList.add("fade-in");
    }, 500);
  }

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
}
