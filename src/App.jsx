import { useEffect, useRef, useState } from "react";

export default function App() {
  const galleryRef = useRef(null);
  const [uiHidden, setUiHidden] = useState(false);
  const [selectedArtwork, setSelectedArtwork] = useState(null);
  const [showIntro, setShowIntro] = useState(true);
  const [showDoors, setShowDoors] = useState(false); // overlay de puertas visible
  const [showDoorAnimation, setShowDoorAnimation] = useState(false); // animando apertura
  const [galleryReady, setGalleryReady] = useState(false); // preload para habilitar botón
  const [isTransitioning, setIsTransitioning] = useState(false);

  const initGallery = async () => {
    try {
      // Mostrar puertas cerradas como pantalla de carga
      setShowDoors(true);

      const { default: ArtGallery3D } = await import("./gallery.js");

      // Crear la galería y esperar a que quede lista para visualizarse
      const instance = await new ArtGallery3D({
        onArtworkSelect: (art) => setSelectedArtwork(art),
      });
      galleryRef.current = instance;

      // Iniciar animación de apertura cuando la escena ya está lista
      setShowDoorAnimation(true);

      // Ocultar puertas al terminar la animación (sin mostrar textos de loading)
      // Asegúrate de que el tiempo coincide con tu animación CSS (ej. 2000-3000ms)
      setTimeout(() => {
        setShowDoors(false);
        setShowDoorAnimation(false);
        setIsTransitioning(false);
      }, 2500);
    } catch (error) {
      console.error(error);
      // En caso de error, quita las puertas para no bloquear la UI
      setShowDoors(false);
      setShowDoorAnimation(false);
      setIsTransitioning(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    // Precargar la galería pero no inicializarla hasta que se presione el botón
    import("./gallery.js").then(({ default: ArtGallery3D }) => {
      if (!isMounted) return;
      // Solo marcar como lista para el botón, pero no crear la instancia aún
      setGalleryReady(true);
    });
    return () => {
      isMounted = false;
      const container = document.getElementById("canvas-container");
      if (container && container.firstChild) {
        try {
          container.removeChild(container.firstChild);
        } catch {}
      }
    };
  }, []);

  // Inicializar la galería cuando se presiona el botón
  useEffect(() => {
    if (isTransitioning && !galleryRef.current) {
      initGallery();
    }
  }, [isTransitioning]);

  const handleEnterGallery = () => {
    // Empezamos transición: puertas cerradas y lanzamos init
    setShowDoors(true);
    setIsTransitioning(true);
    setShowIntro(false); // ocultar la intro de inmediato
  };

  return (
    <div id="app">
      {/* Página de Introducción */}
      {showIntro && (
        <div className="intro-page">
          <div className="intro-content">
            <h1 className="intro-title">Galería de Arte 3D</h1>
            <p className="intro-subtitle">Una experiencia inmersiva única</p>
            <button
              className="enter-button"
              onClick={handleEnterGallery}
              disabled={!galleryReady}
            >
              {galleryReady ? "Entrar a la Galería" : "Cargando..."}
            </button>
          </div>
        </div>
      )}

      {/* Puertas: actúan como pantalla de carga; se abren cuando la galería está lista */}
      {showDoors && (
        <div
          className={`doors-container ${
            showDoorAnimation ? "opening" : "closed"
          }`}
        >
          <div className="door left-door">
            <div className="door-content">
              <div className="door-handle"></div>
              <div className="door-pattern"></div>
            </div>
          </div>
          <div className="door right-door">
            <div className="door-content">
              <div className="door-handle"></div>
              <div className="door-pattern"></div>
            </div>
          </div>
        </div>
      )}

      <nav className="navigation-ui">
        <div className="nav-header">
          <h1>Galería de Arte 3D</h1>
          <div className="nav-controls">
            <button
              className="nav-btn"
              onClick={() => setUiHidden((v) => !v)}
              id="toggle-ui"
            >
              {uiHidden ? "Mostrar UI" : "Ocultar UI"}
            </button>
            <button
              className="nav-btn"
              onClick={() => {
                galleryRef.current?.resetCamera();
                setSelectedArtwork(null);
              }}
              id="reset-camera"
            >
              Reset Cámara
            </button>
            {selectedArtwork && (
              <button
                className="nav-btn"
                onClick={() => {
                  galleryRef.current?.deselectArtwork?.();
                  setSelectedArtwork(null);
                }}
                id="unlock-view"
              >
                Salir de obra
              </button>
            )}
          </div>
        </div>

        {/* <div className="gallery-info">
          <div className="current-room">
            <h3>
              Sala Actual: <span id="room-name">{room.name}</span>
            </h3>
            <p id="room-description">
              {room.description} Usa W/S para avanzar y retroceder.
            </p>
          </div>
        </div> */}
      </nav>

      <div
        className={`artwork-info ${uiHidden ? "hidden" : ""}`}
        id="artwork-info"
      >
        <h4>Obra Seleccionada</h4>
        <p id="artwork-title">
          {selectedArtwork?.title || "Selecciona una obra para ver detalles"}
        </p>
        <p id="artwork-artist">
          {selectedArtwork ? `Artista: ${selectedArtwork.artist}` : ""}
        </p>
        <p id="artwork-description">{selectedArtwork?.description || ""}</p>
      </div>

      <div className={`instructions ${uiHidden ? "hidden" : ""}`}>
        <div className="instruction-content">
          <h3>Controles de Navegación</h3>
          <ul>
            <li>
              <strong>W/S</strong> - Avanzar/Retroceder
            </li>
            <li>
              <strong>Espacio</strong> - Vista de la obra mas cercana
            </li>
            <li>
              <strong>Escape</strong> - Salir de la vista de obra
            </li>
          </ul>
        </div>
      </div>

      <div
        id="canvas-container"
        style={{
          display: showIntro ? "none" : "block",
          opacity: 1, // visible detrás de las puertas en todo momento
          transition: "opacity 0.6s ease-in-out",
        }}
      ></div>

      {/* <div className="room-navigation">
        <button
          className={`room-btn ${room.key === "galeria" ? "active" : ""}`}
          data-room="galeria"
          onClick={() => galleryRef.current?.changeRoom("galeria")}
        >
          Galería
        </button>
      </div> */}
    </div>
  );
}
