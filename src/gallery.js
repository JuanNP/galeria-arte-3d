import * as THREE from "three";
import { gsap } from "gsap";

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
    this.setupControls();
    this.setupLights();
    this.createRooms();
    this.createArtworks();
    this.animate();

    setTimeout(() => {
      this.hideLoadingScreen();
    }, 1000);
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
    this.camera.position.set(0, 2, 10);
    this.camera.lookAt(0, 2, 0);
    this.camera.layers.enable(1);
    // Cache initial camera transform for reset
    this._initialCamPos = this.camera.position.clone();
    this._initialCamQuat = this.camera.quaternion.clone();
    // Smooth look-at helpers
    this._lookAtTarget = new THREE.Vector3(0, 2, 0);
    this._lookAtDummy = new THREE.Object3D();
    // Camera smoothing and sensitivity tweaks
    this._targetLerp = 0.3;
    this._slerpFactor = 0.25;
    this._mouseSensitivity = 0.016;
    this._maxPitch = Math.PI / 3; // ~60° up/down
    this._lookRadius = 10; // meters to virtual look-at focus
    // Smooth target interpolation & view lock
    this._lookAtTargetDesired = new THREE.Vector3(0, 2, 0);
    this._isViewLocked = false;
    this._lockedTarget = null;
    // Movement keys and speed
    this._clock = new THREE.Clock();
    this._keys = { w: false, s: false };
    this._moveSpeed = 10.0;
    // Slight self-illumination so images don't look too dark under spot shadows
    this._artEmissiveBoost = 0.45; // subtle self-illumination to keep details visible
    // If true, artworks use an unlit material (always fully illuminated)
    this._artUnlit = true;
    // Brightness multiplier for unlit artworks (0.0–1.0; 1 = original texture)
    this._artUnlitBrightness = 0.25;
    // Constant: distance from floor to the **bottom** of every artwork (meters)
    this._artBottomMargin = 1.1;
    // Optional FPS cap (set to 60; set to 0 to disable)
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
    let isMouseDown = false;
    let mouseX = 0;
    let mouseY = 0;
    // Store target rotations on the instance so we can reset them
    this._targetRotationX = 0;
    this._targetRotationY = 0;
    this._freezeRotation = false;

    this.renderer.domElement.addEventListener("mousedown", (event) => {
      isMouseDown = true;
      mouseX = event.clientX;
      mouseY = event.clientY;
    });

    this.renderer.domElement.addEventListener("mouseup", () => {
      isMouseDown = false;
    });

    // Track last pointerId to safely release capture later
    this._lastPointerId = null;
    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      this._lastPointerId = e.pointerId;
    });
    this.renderer.domElement.addEventListener("pointerup", () => {
      this._lastPointerId = null;
    });

    this.renderer.domElement.addEventListener("mousemove", (event) => {
      if (isMouseDown) {
        // Mouse-look disabled: do not change rotations
        mouseX = event.clientX;
        mouseY = event.clientY;
        return;
      }
    });

    // Raycasting para hover/click en obras
    const raycaster = new THREE.Raycaster();
    // Raycast only against artworks (layer 1)
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

    // Throttle hover raycasting
    let hoverRAF = null;
    let lastMoveEvt = null;
    let lastHover = null;
    this.renderer.domElement.addEventListener("mousemove", (event) => {
      if (this._isViewLocked) return;
      if (this._isCameraTweening) return;
      if (isMouseDown) return;
      lastMoveEvt = event;
      if (hoverRAF) return;
      hoverRAF = requestAnimationFrame(() => {
        hoverRAF = null;
        const hits = getIntersections(lastMoveEvt);
        const hit = hits.find((h) => h.object?.parent);
        const group = hit?.object?.parent;
        if (lastHover && lastHover !== group) {
          this.highlightArtwork(lastHover, false);
        }
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
      if (this._isCameraTweening) return;
      const hits = getIntersections(event);
      const hit = hits.find((h) => h.object?.parent);
      const group = hit?.object?.parent;
      if (!group) return;
      const art = this.artworks.find((a) => a.mesh === group);
      if (art) this.selectArtwork(art);
    });

    // Keyboard handling with smoother movement
    document.addEventListener("keydown", (event) => {
      // Allow Escape to work even when view is locked
      if (event.code === "Escape") {
        console.log("Escape pressed");
        this.deselectArtwork();
        // Also call the callback to update React state
        this.onArtworkSelect(null);
        return;
      }

      // Block other keys when view is locked
      if (this._isViewLocked) return;

      if (event.code === "KeyW") this._keys.w = true;
      if (event.code === "KeyS") this._keys.s = true;
      if (event.code === "Space") this.selectNearestArtwork?.();
    });
    document.addEventListener("keyup", (event) => {
      if (event.code === "KeyW") this._keys.w = false;
      if (event.code === "KeyS") this._keys.s = false;
    });

    this.updateCameraRotation = () => {
      if (this._freezeRotation) return;
      // Mouse look now only updates target look-at, not direct Euler angles.
      // The actual orientation is handled by _updateSmoothLook().
    };

    // Mouse-look disabled: free-view orientation no longer follows mouse
    this.renderer.domElement.addEventListener("mousemove", () => {
      // Mouse-look disabled: free-view orientation no longer follows mouse
    });
  }

  _updateSmoothLook() {
    if (!this._lookAtTarget) return;
    if (this._lookAtTargetDesired) {
      this._lookAtTarget.lerp(this._lookAtTargetDesired, this._targetLerp);
    }
    // When not locked, aim forward down the corridor (mouse-look disabled)
    if (!this._isViewLocked) {
      const forward = new THREE.Vector3(0, 0, -1);
      this._lookAtTarget.copy(
        this.camera.position
          .clone()
          .add(forward.multiplyScalar(this._lookRadius))
          .setY(2)
      );
      this._lookAtTargetDesired.copy(this._lookAtTarget);
    }
    // If locked, force both targets to the locked point
    if (this._isViewLocked && this._lockedTarget) {
      this._lookAtTarget.copy(this._lockedTarget);
      this._lookAtTargetDesired.copy(this._lockedTarget);
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
    let dz = 0;
    if (this._keys.w) dz -= this._moveSpeed * dt;
    if (this._keys.s) dz += this._moveSpeed * dt;
    if (!dz) return;
    this.camera.position.z += dz;
    const marginZ = 2.5;
    const corridorLength = this.corridor?.length || 80;
    const halfLen = corridorLength / 2 - marginZ;
    this.camera.position.z = THREE.MathUtils.clamp(
      this.camera.position.z,
      -halfLen,
      halfLen
    );
    this.camera.position.x = 0;
    this.camera.position.y = 2;
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
    // Generic corridor point lights (soft fill along the hall)
    const corridorLightPositions = [-30, -15, 0, 15, 30];
    this._points = [];
    corridorLightPositions.forEach((z) => {
      const point = new THREE.PointLight(0xffffff, 0.8, 30);
      point.position.set(0, 7, z);
      point.castShadow = false;
      this.scene.add(point);
      this._points.push(point);
    });
  }

  generateConcreteTexture(size = 256) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#bdbdbd";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 80; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 10 + Math.random() * 40;
      const a = 0.04 + Math.random() * 0.06;
      ctx.fillStyle = `rgba(120,120,120,${a})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < size * size * 0.02; i++) {
      const x = (Math.random() * size) | 0;
      const y = (Math.random() * size) | 0;
      const c = (180 + Math.random() * 60) | 0;
      const a = 0.05 + Math.random() * 0.05;
      ctx.fillStyle = `rgba(${c},${c},${c},${a})`;
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
    this.rooms.galeria = this.createCorridor();
  }

  createCorridor() {
    const corridorGroup = new THREE.Group();
    const corridorLength = 80;
    const corridorWidth = 6;
    const wallHeight = 8;
    this.corridor = {
      length: corridorLength,
      width: corridorWidth,
      wallHeight,
    };

    // Piso concreto (modelo)
    // Swap dimensions so the floor aligns with corridor length (Z) and width (X)
    const floorGeometry = new THREE.PlaneGeometry(
      corridorWidth,
      corridorLength
    );
    const concreteMap = this.generateConcreteTexture(512);
    concreteMap.repeat.set(corridorWidth / 6, corridorLength / 20);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0xbdbdbd,
      map: concreteMap,
      roughness: 0.95,
      metalness: 0.0,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    // tiny offset to avoid z-fighting with shadow maps
    floor.position.y = -0.001;
    floor.receiveShadow = true;
    corridorGroup.add(floor);

    // Techo
    // Swap dimensions for ceiling to match corridor orientation
    const ceilingGeometry = new THREE.PlaneGeometry(
      corridorWidth,
      corridorLength
    );
    const ceilingMap = this.generateWhiteNoiseTexture(256, "#ffffff", 0.03);
    ceilingMap.repeat.set(corridorWidth / 6, corridorLength / 20);
    const ceilingMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: ceilingMap,
      roughness: 0.9,
      metalness: 0.0,
    });
    const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, wallHeight + 0.001, 0);
    corridorGroup.add(ceiling);

    // Paredes
    const wallThickness = 0.2;
    const sideWallGeometry = new THREE.BoxGeometry(
      wallThickness,
      wallHeight,
      corridorLength
    );
    const wallMap = this.generateWhiteNoiseTexture(256, "#ffffff", 0.03);
    wallMap.repeat.set(corridorLength / 20, wallHeight / 4);
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: wallMap,
      roughness: 0.85,
      metalness: 0.0,
    });
    const leftWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
    leftWall.position.set(-corridorWidth / 2, wallHeight / 2, 0);
    leftWall.castShadow = true;
    leftWall.receiveShadow = true;
    corridorGroup.add(leftWall);
    const rightWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
    rightWall.position.set(corridorWidth / 2, wallHeight / 2, 0);
    rightWall.castShadow = true;
    rightWall.receiveShadow = true;
    corridorGroup.add(rightWall);
    // Store wall references for collision checks
    this.corridor.leftWall = leftWall;
    this.corridor.rightWall = rightWall;

    // Riel de iluminación
    this.createLightTracks(
      corridorGroup,
      corridorLength,
      corridorWidth,
      wallHeight
    );

    this.scene.add(corridorGroup);
    return corridorGroup;
  }

  createLightTracks(parent, corridorLength, corridorWidth, wallHeight) {
    const trackLength = corridorLength - 6;
    // Long axis along Z to align with corridor direction
    const trackGeometry = new THREE.BoxGeometry(0.15, 0.05, trackLength);
    const trackMaterial = new THREE.MeshStandardMaterial({
      color: 0x2b2b2b,
      roughness: 0.8,
    });
    const track = new THREE.Mesh(trackGeometry, trackMaterial);
    track.position.set(0, wallHeight - 0.6, 0);
    parent.add(track);

    // Evenly spaced ceiling spotlights aiming to each wall
    const numSpots = Math.max(6, Math.floor(corridorLength / 8));
    const startZ = -trackLength / 2;
    const stepZ = trackLength / (numSpots - 1);
    this._spots = [];
    for (let i = 0; i < numSpots; i++) {
      const z = startZ + i * stepZ;
      const y = wallHeight - 0.5;

      // Left wall target
      const spotL = new THREE.SpotLight(
        0xffffff,
        0.65,
        22,
        Math.PI / 8,
        0.4,
        1.5
      );
      spotL.position.set(0, y, z);
      spotL.target.position.set(-corridorWidth / 2 - 0.01 + 0.21, 2, z); // +0.2 de separación de pared
      spotL.castShadow = true;
      spotL.shadow.mapSize.set(1024, 1024);
      spotL.shadow.bias = -0.0002;
      this.scene.add(spotL);
      this.scene.add(spotL.target);
      this._spots.push(spotL);

      // Right wall target
      const spotR = new THREE.SpotLight(
        0xffffff,
        0.65,
        22,
        Math.PI / 8,
        0.4,
        1.5
      );
      spotR.position.set(0, y, z);
      spotR.target.position.set(corridorWidth / 2 + 0.01 - 0.21, 2, z); // -0.2 de separación de pared
      spotR.castShadow = true;
      spotR.shadow.mapSize.set(1024, 1024);
      spotR.shadow.bias = -0.0002;
      this.scene.add(spotR);
      this.scene.add(spotR.target);
      this._spots.push(spotR);
    }
  }

  rebuildArtworkSpots() {
    // Remove existing artwork spots
    for (const s of this._spots) {
      if (s.target && s.target.parent) s.target.parent.remove(s.target);
      if (s.parent) s.parent.remove(s);
    }
    this._spots = [];

    const corridorLength = this.corridor?.length || 80;
    const corridorWidth = this.corridor?.width || 6;
    const wallHeight = this.corridor?.wallHeight || 8;

    // Create one spotlight per artwork, positioned directly above its wall, aimed at the artwork center
    for (const a of this.artworks) {
      if (!a || !a.mesh) continue;
      const z = a.mesh.position.z;
      const y = wallHeight - 0.3; // near ceiling
      // Place the light over the same wall as the artwork, slightly off the wall
      const overX =
        a.side === "left"
          ? -corridorWidth / 2 + 0.35
          : corridorWidth / 2 - 0.35;

      // Strong, clearly visible spotlight with reliable shadows
      const spot = new THREE.SpotLight(0xfff1e0, 2.4, 18, Math.PI / 6, 0.5, 2);
      spot.position.set(overX, y, z);
      // Light affects both default (0) and artworks (1) layers
      spot.layers.enable(1);

      // Target: artwork center, nudged off the wall to avoid grazing
      const artCenter = new THREE.Vector3();
      new THREE.Box3().setFromObject(a.mesh).getCenter(artCenter);
      const targetX =
        a.side === "left" ? artCenter.x + 0.12 : artCenter.x - 0.12;
      spot.target.position.set(targetX, artCenter.y, artCenter.z);

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

      // Precompute corridor/spacing variables
      const N = artworksData.length;
      const corridorWidth = this.corridor?.width || 6;
      const corridorLength = this.corridor?.length || 80;
      const halfLen = corridorLength / 2;
      const endMargin = 2.0; // meters from each end cap
      const frameDepth = 0.1; // matches frame BoxGeometry depth
      const gap = 0.12; // small gap from wall to avoid z-fighting
      const xInner = corridorWidth / 2 - (frameDepth + gap);
      const startZ = -halfLen + endMargin;
      const spacingZ = N > 1 ? (2 * (halfLen - endMargin)) / (N - 1) : 0; // fill entire corridor

      artworksData.forEach((data, i) => {
        const sideRight = i % 2 === 0; // alternate sides
        const xOffset = sideRight ? xInner : -xInner;
        const z = startZ + i * spacingZ; // uniformly across corridor
        const y = 2; // eye-level center

        const artworkData = {
          ...data,
          image: this._resolveArtworkImage(data.image),
          position: [xOffset, y, z],
          side: sideRight ? "right" : "left",
        };
        this.createArtwork(artworkData, i);
      });
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
        this._applyDisplaySize(frame, canvas, w, h);
        data.size = [w, h];
        // Place the artwork so the bottom sits at a constant margin above the floor
        const [x0, , z0] = data.position;
        const newY = this._artBottomMargin + h * 0.5;
        data.position = [x0, newY, z0];
        artworkGroup.position.y = newY;
        // Local fill light so the artwork reads as fully illuminated
        this._attachArtworkFillLight(artworkGroup, w, h);
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
      this._applyDisplaySize(frame, canvas, w0, h0);
      data.size = [w0, h0];
      // Place the artwork so the bottom sits at a constant margin above the floor
      const [x0, , z0] = data.position;
      const newY = this._artBottomMargin + h0 * 0.5;
      data.position = [x0, newY, z0];
      artworkGroup.position.y = newY;
      // Local fill light so the artwork reads as fully illuminated
      this._attachArtworkFillLight(artworkGroup, w0, h0);
    }

    data.mesh = artworkGroup;
    data.index = index;
    this.artworks.push(data);

    const [x, y, z] = data.position;
    artworkGroup.position.set(x, y, z);
    if (data.side === "left") {
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
    this.onArtworkSelect?.(artwork);
    const group = artwork.mesh;
    if (!group) return;
    group.updateWorldMatrix(true, true);

    // World-space center of the artwork
    const bbox = new THREE.Box3().setFromObject(group);
    const center = new THREE.Vector3();
    bbox.getCenter(center);

    // Lock the view to the artwork and reset yaw/pitch
    this._lockedTarget = center.clone();
    this._isViewLocked = true;
    this._lookAtTarget = center.clone();
    this._lookAtTargetDesired = center.clone();
    this._targetRotationX = 0;
    this._targetRotationY = 0;

    // Place camera on the opposite wall for a natural, front-facing view
    const half = (this.corridor?.width || 6) / 2;
    const wallGuard = 0.35; // keep a small offset from the wall to avoid clipping
    // If artwork is on left wall (x < 0), go to right wall (+X); if on right wall, go to left (-X)
    const destX = center.x < 0 ? half - wallGuard : -half + wallGuard;
    // Keep same Y and Z as the artwork center for perfect alignment
    const dest = new THREE.Vector3(destX, center.y, center.z);

    // Freeze mouse smoothing while we animate and keep the camera looking at the art
    this._freezeRotation = true;
    // Release pointer capture to avoid stuck drag state during tween
    if (
      this._lastPointerId != null &&
      this.renderer.domElement.hasPointerCapture?.(this._lastPointerId)
    ) {
      try {
        this.renderer.domElement.releasePointerCapture(this._lastPointerId);
      } catch {}
    }
    // Ensure GSAP picks up the latest camera position values
    this.camera.position.x = this.camera.position.x;
    this.camera.position.y = this.camera.position.y;
    this.camera.position.z = this.camera.position.z;
    // Ensure camera has a consistent up vector to prevent flips
    this.camera.up.set(0, 1, 0);
    // Mark tweening (used to gate inputs) and pre-orient once toward the artwork center
    this._isCameraTweening = true;
    this._lookAtDummy.position.copy(this.camera.position);
    this._lookAtDummy.lookAt(center);
    this.camera.quaternion.copy(this._lookAtDummy.quaternion);
    gsap.to(this.camera.position, {
      x: dest.x,
      y: dest.y,
      z: dest.z,
      duration: 1.0,
      ease: "power3.inOut",
      onUpdate: () => {
        // Keep lock targets pinned at the artwork center; orientation handled by _updateSmoothLook()
        this._lockedTarget.copy(center);
        this._lookAtTarget.copy(center);
        this._lookAtTargetDesired.copy(center);
      },
      onComplete: () => {
        this._freezeRotation = false;
        this._isCameraTweening = false;
        // remain locked on artwork until user deselects
        this._lockedTarget.copy(center);
        this._lookAtTarget.copy(center);
        this._lookAtTargetDesired.copy(center);
      },
    });
  }

  deselectArtwork() {
    // Unlock view-lock state
    this._isViewLocked = false;
    this._lockedTarget = null;
    this.selectedArtwork = null;

    // Target: recenter X only (keep current Z), at eye height
    const corridorLength = this.corridor?.length || 80;
    const halfLen = corridorLength / 2 - 2.5; // respect movement clamps
    const currentZ = THREE.MathUtils.clamp(
      this.camera.position.z,
      -halfLen,
      halfLen
    );
    const end = new THREE.Vector3(0, 2, currentZ);

    // Prepare tween flags
    this._freezeRotation = true;
    this._isCameraTweening = true;
    this.camera.up.set(0, 1, 0);

    gsap.to(this.camera.position, {
      x: end.x,
      y: end.y,
      z: end.z,
      duration: 1.0,
      ease: "power3.inOut",
      onUpdate: () => {
        // Aim forward down the corridor while returning
        const forward = new THREE.Vector3(0, 0, -1);
        const look = this.camera.position
          .clone()
          .add(forward.multiplyScalar(this._lookRadius))
          .setY(2);
        this._lookAtTarget.copy(look);
        this._lookAtTargetDesired.copy(look);
      },
      onComplete: () => {
        this._freezeRotation = false;
        this._isCameraTweening = false;
        // Ensure unlocked forward look is kept after tween
        const forward = new THREE.Vector3(0, 0, -1);
        const look = this.camera.position
          .clone()
          .add(forward.multiplyScalar(this._lookRadius))
          .setY(2);
        this._lookAtTarget.copy(look);
        this._lookAtTargetDesired.copy(look);
      },
    });
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
    if (!this.camera) return;
    if (this._initialCamPos && this._initialCamQuat) {
      this.camera.position.copy(this._initialCamPos);
      this.camera.quaternion.copy(this._initialCamQuat);
    } else {
      // Fallback default
      this.camera.position.set(0, 2, 10);
      this.camera.lookAt(0, 2, 0);
    }
    // Reset mouse-look smoothing targets
    this._targetRotationX = 0;
    this._targetRotationY = 0;
    // Ensure camera is oriented to initial look direction
    this.camera.lookAt(0, 2, 0);
    this._lookAtTarget = new THREE.Vector3(0, 2, 0);
    this._targetRotationX = 0;
    this._targetRotationY = 0;
  }

  hideLoadingScreen() {
    const loadingScreen = document.getElementById("loading-screen");
    if (!loadingScreen) return;
    loadingScreen.style.opacity = "0";
    setTimeout(() => {
      loadingScreen.style.display = "none";
      this.isLoading = false;
      document.getElementById("app")?.classList.add("fade-in");
    }, 500);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    // FPS cap (skip rendering if frame arrived too soon)
    if (this._fpsCap && this._fpsCap > 0) {
      const now = performance.now();
      const minMs = 1000 / this._fpsCap;
      if (this._lastFrameTime && now - this._lastFrameTime < minMs) {
        return; // next RAF ya programado
      }
      this._lastFrameTime = now;
    }
    const dt = this._clock.getDelta();
    this._updateMovement(dt);
    // Dynamic resolution uses the measured milliseconds for this frame
    this._dynamicResTick(dt * 1000);
    this._updateCulling();
    this._updateLOD();
    if (!this.isLoading) {
      this.updateCameraRotation();
    }
    this._updateSmoothLook();
    this.renderer.render(this.scene, this.camera);
  }
}
