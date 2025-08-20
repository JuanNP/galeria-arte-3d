import { useEffect, useRef, useState } from "react";

export default function App() {
  const galleryRef = useRef(null);
  const [uiHidden, setUiHidden] = useState(false);
  const [room, setRoom] = useState({
    key: "galeria",
    name: "Galería",
    description: "Pasillo de galería con paredes blancas y piso gris.",
  });
  const [selectedArtwork, setSelectedArtwork] = useState(null);

  useEffect(() => {
    let isMounted = true;
    import("./gallery.js").then(({ default: ArtGallery3D }) => {
      if (!isMounted) return;
      galleryRef.current = new ArtGallery3D({
        onRoomChange: (info) => setRoom(info),
        onArtworkSelect: (art) => setSelectedArtwork(art),
      });
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

  return (
    <div id="app">
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
              onClick={() => galleryRef.current?.resetCamera()}
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

        <div className="gallery-info">
          <div className="current-room">
            <h3>
              Sala Actual: <span id="room-name">{room.name}</span>
            </h3>
            <p id="room-description">
              {room.description} Usa W/S para avanzar y retroceder.
            </p>
          </div>

          <div className="artwork-info" id="artwork-info">
            <h4>Obra Seleccionada</h4>
            <p id="artwork-title">
              {selectedArtwork?.title ||
                "Selecciona una obra para ver detalles"}
            </p>
            <p id="artwork-artist">
              {selectedArtwork ? `Artista: ${selectedArtwork.artist}` : ""}
            </p>
            <p id="artwork-description">{selectedArtwork?.description || ""}</p>
          </div>
        </div>
      </nav>

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
          </ul>
        </div>
      </div>

      <div id="canvas-container"></div>

      <div className="room-navigation">
        <button
          className={`room-btn ${room.key === "galeria" ? "active" : ""}`}
          data-room="galeria"
          onClick={() => galleryRef.current?.changeRoom("galeria")}
        >
          Galería
        </button>
      </div>
    </div>
  );
}
