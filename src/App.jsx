import { useEffect, useRef, useState } from "react";

export default function App() {
  const galleryRef = useRef(null);
  const [uiHidden, setUiHidden] = useState(false);
  const [selectedArtwork, setSelectedArtwork] = useState(null);
  const [showIntro, setShowIntro] = useState(true);
  const [showDoors, setShowDoors] = useState(false);
  const [galleryReady, setGalleryReady] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    let isMounted = true;
    import("./gallery.js").then(({ default: ArtGallery3D }) => {
      if (!isMounted) return;
      galleryRef.current = new ArtGallery3D({
        onArtworkSelect: (art) => setSelectedArtwork(art),
      });
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

  const handleEnterGallery = () => {
    setIsTransitioning(true);
    setShowDoors(true);

    // Ocultar la intro inmediatamente para evitar el flash
    setTimeout(() => {
      setShowIntro(false);
    }, 100);

    // Esperar a que la galería esté lista y luego completar la transición
    const checkGalleryReady = () => {
      if (galleryReady) {
        // La galería está lista, completar la transición después de la animación
        setTimeout(() => {
          setShowDoors(false);
          setIsTransitioning(false);
        }, 1800); // Un poco antes del final de la animación
      } else {
        // La galería aún no está lista, esperar un poco más
        setTimeout(checkGalleryReady, 100);
      }
    };

    // Iniciar verificación después de un pequeño delay
    setTimeout(checkGalleryReady, 200);
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

      {/* Animación de Puertas */}
      {showDoors && (
        <div className="doors-animation">
          <div className="door left-door"></div>
          <div className="door right-door"></div>
          {/* Overlay negro para transición suave */}
          <div className="doors-overlay"></div>
        </div>
      )}

      {/* Pantalla de transición */}
      {isTransitioning && !showDoors && (
        <div className="transition-screen">
          <div className="transition-content">
            <div className="transition-spinner"></div>
            <p>Preparando la galería...</p>
          </div>
        </div>
      )}

      <div id="loading-screen">
        <div className="loading-content">
          <div className="loading-spinner"></div>
          <h2>Cargando Galería de Arte</h2>
          <p>Preparando tu experiencia inmersiva...</p>
        </div>
      </div>

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
          opacity: isTransitioning ? 0 : 1,
          transition: "opacity 0.5s ease-in-out",
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
