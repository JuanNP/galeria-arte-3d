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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    container.appendChild(this.renderer.domElement);

    window.addEventListener("resize", () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
  }

  // Resolve asset URLs whether they live under /public or /src/assets (Vite-friendly)
  _resolveAssetUrl(path) {
    if (!path) return path;
    // Absolute http(s) or data URLs pass through
    if (/^(https?:)?\/\//.test(path) || /^data:/.test(path)) return path;
    // If starts with '/': assume public root, but also provide a module-relative fallback
    // by rewriting '/assets/...' -> '../assets/...'
    if (path.startsWith("/")) {
      try {
        // Try public path first
        return path;
      } catch (_) {}
      // Fallback to module-relative (useful in dev if assets are in src/assets)
      const rel = path.replace(/^\//, "");
      return new URL("../" + rel, import.meta.url).href;
    }
    // Relative path given -> resolve relative to this module file
    try {
      return new URL(path, import.meta.url).href;
    } catch (_) {
      return path;
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
        console.warn("No se pudo cargar la imagen de la obra:", url, err);
        onError?.(err);
      }
    );
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
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -20;
    directionalLight.shadow.camera.right = 20;
    directionalLight.shadow.camera.top = 20;
    directionalLight.shadow.camera.bottom = -20;
    this.scene.add(directionalLight);

    const corridorLightPositions = [-30, -15, 0, 15, 30];
    corridorLightPositions.forEach((z) => {
      const point = new THREE.PointLight(0xffffff, 0.6, 30);
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
    corridorGroup.add(leftWall);
    const rightWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
    rightWall.position.set(corridorWidth / 2, wallHeight / 2, 0);
    rightWall.castShadow = true;
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
    const numSpots = 10;
    for (let i = 0; i < numSpots; i++) {
      // Define which indices will have shadows enabled
      const shadowIndices = new Set([
        Math.floor(numSpots * 0.25),
        Math.floor(numSpots * 0.75),
      ]);
      const enableShadow = shadowIndices.has(i);
      const t = (i / (numSpots - 1)) * trackLength - trackLength / 2;
      const spotL = new THREE.SpotLight(
        0xffffff,
        0.6,
        20,
        Math.PI / 8,
        0.4,
        1.5
      );
      spotL.position.set(0, wallHeight - 0.5, t);
      spotL.target.position.set(-corridorWidth / 2 + 0.2, 3, t);
      spotL.castShadow = enableShadow;
      parent.add(spotL);
      parent.add(spotL.target);
      this._spots.push(spotL);
      const spotR = new THREE.SpotLight(
        0xffffff,
        0.6,
        20,
        Math.PI / 8,
        0.4,
        1.5
      );
      spotR.position.set(0, wallHeight - 0.5, t);
      spotR.target.position.set(corridorWidth / 2 - 0.2, 3, t);
      spotR.castShadow = enableShadow;
      parent.add(spotR);
      parent.add(spotR.target);
      this._spots.push(spotR);
    }
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
      let artworksData = null;
      // 1) Try public path '/assets/artworks.json'
      try {
        const r1 = await fetch("/assets/artworks.json");
        if (r1.ok) artworksData = await r1.json();
      } catch {}
      // 2) Try public root '/artworks.json'
      if (!artworksData) {
        try {
          const r2 = await fetch("/artworks.json");
          if (r2.ok) artworksData = await r2.json();
        } catch {}
      }
      // 3) Try module import from src assets (Vite supports JSON import)
      if (!artworksData) {
        try {
          const mod = await import("../assets/artworks.json");
          artworksData = mod.default || mod;
        } catch {}
      }
      if (!artworksData) throw new Error("No se pudo cargar artworks.json");

      artworksData.forEach((data, i) => {
        // Place artworks against inner wall surface (corridor width aware)
        const corridorWidth = this.corridor?.width || 6;
        const frameDepth = 0.1; // matches frame BoxGeometry depth
        const gap = 0.12; // small gap from wall to avoid z-fighting
        const xInner = corridorWidth / 2 - (frameDepth + gap);
        const sideRight = i % 2 === 0; // alternate sides
        const xOffset = sideRight ? xInner : -xInner;

        const zSpacing = 6; // meters between artworks along corridor
        const z = -i * zSpacing;
        const y = 2; // center height

        const artworkData = {
          ...data,
          image: this._resolveAssetUrl(data.image),
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
    const frameGeometry = new THREE.BoxGeometry(
      data.size[0] + 0.2,
      data.size[1] + 0.2,
      0.1
    );
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.5,
      metalness: 0.05,
    });
    const frame = new THREE.Mesh(frameGeometry, frameMaterial);
    frame.castShadow = true;
    artworkGroup.add(frame);

    const canvasGeometry = new THREE.PlaneGeometry(data.size[0], data.size[1]);
    const canvasMaterial = new THREE.MeshStandardMaterial({
      roughness: 1.0,
      metalness: 0.0,
    });

    // Prefer custom image if provided; otherwise use generated textures with LOD
    if (data.image) {
      const imgUrl = this._resolveAssetUrl(data.image);
      this._loadArtworkTexture(imgUrl, (texture) => {
        canvasMaterial.map = texture;
        canvasMaterial.needsUpdate = true;
        data._hasCustomImage = true;
        data._canvasMaterial = canvasMaterial;
      });
    } else {
      const artMapLow = this.generateArtworkTexture(256, 256);
      const artMapHigh = this.generateArtworkTexture(512, 512);
      canvasMaterial.map = artMapLow;
      canvasMaterial.needsUpdate = true;
      data._artMapLow = artMapLow;
      data._artMapHigh = artMapHigh;
      data._canvasMaterial = canvasMaterial;
      data._currentLOD = "low";
    }

    const canvas = new THREE.Mesh(canvasGeometry, canvasMaterial);
    canvas.position.z = 0.06;
    canvas.castShadow = true;
    artworkGroup.add(canvas);

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
    this._isViewLocked = false;
    this._lockedTarget = null;
    // aim forward down the corridor from current position
    const forwardYaw = 0; // face -Z
    const pitch = 0;
    const dir = new THREE.Vector3(
      Math.sin(forwardYaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(forwardYaw) * Math.cos(pitch)
    );
    this._lookAtTargetDesired = this.camera.position
      .clone()
      .add(dir.multiplyScalar(this._lookRadius))
      .setY(2);
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
