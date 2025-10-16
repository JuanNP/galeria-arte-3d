# Galería de Arte 3D - Experiencia Inmersiva

Experiencia de galería 3D interactiva con React + Vite + Three.js. Explora un pasillo de galería con obras alternadas a ambos lados, animaciones suaves, bloqueo de vista a obras y una introducción con puertas animadas.

## 🎨 Características

- **Navegación 3D inmersiva** con controles W/S
- **Selección de obra** por clic o tecla Espacio, con encuadre automático
- **Intro con puertas**: pantalla de inicio y apertura animada al entrar
- **Iluminación realista**: focos de techo por obra y luz de relleno local
- **LOD y resolución dinámica**: rendimiento fluido con cambio de texturas según distancia
- **Culling inteligente**: solo se renderiza lo visible alrededor de la cámara
- **UI integrada**: ocultar/mostrar interfaz, reset de cámara y salir de obra
- **Listo para GitHub Pages** con `base` configurado

## 🚀 Instalación

1. **Clona o descarga** este proyecto
2. **Instala dependencias**:
   ```bash
   npm install
   ```
3. **Desarrollo local (recomendado)**:
   ```bash
   npm run dev:local
   ```
   Abre `http://localhost:3001`
4. (Alternativa) **Dev usando config de producción**:
   ```bash
   npm run dev
   ```
   También en `http://localhost:3001` pero con `base` de producción activo

## 🎮 Controles

### Navegación Básica

- **W / S**: Avanzar / Retroceder por el pasillo
- **Espacio**: Seleccionar la obra más cercana y encuadrar la cámara
- **Escape**: Salir de la vista de obra (desbloquear)

### Interfaz

- **Ocultar/Mostrar UI**: Alterna la interfaz de navegación
- **Reset Cámara**: Vuelve a la pose inicial de la cámara
- **Salir de obra**: Aparece cuando hay una obra seleccionada

## 🏗️ Estructura del Proyecto

```
galeria-arte-3d/
├── index.html               # HTML principal (monta React en #root)
├── style.css                # Estilos de la app (UI/intro/puertas)
├── package.json             # Scripts y metadatos (homepage, deploy)
├── vite.config.js           # Prod (base: "/galeria-arte-3d/")
├── vite.config.dev.js       # Dev local (base: "/")
├── assets/
│   ├── artworks.json        # Datos de obras (fuente de verdad)
│   ├── images/              # Imágenes de obras
│   ├── models/              # Modelos 3D (opcional)
│   └── textures/            # Texturas (opcional)
├── src/
│   ├── main.jsx             # Punto de entrada React/Vite
│   ├── App.jsx              # UI (intro, puertas, HUD, contenedores)
│   └── gallery.js           # Lógica Three.js (escena, luces, obras)
└── README.md                # Este archivo
```

## 🛠️ Tecnologías Utilizadas

- **React 18** - UI y estado
- **Three.js** - Gráficos 3D
- **GSAP** - Animaciones/transiciones
- **Vite 5** - Dev server y build
- **CSS3** - Estilos

## 🎯 Personalización

### Agregar/editar obras en `assets/artworks.json`

Las obras se cargan dinámicamente desde `assets/artworks.json`. Puedes usar nombres de archivo o rutas relativas dentro de `assets/images`.

Esquema básico de cada obra:

```json
{
  "title": "Título de la Obra",
  "artist": "Nombre del Artista",
  "description": "Descripción corta",
  "image": "art_01.jpg"
}
```

Notas:

- Si pones solo el nombre del archivo (`"art_01.jpg"`), se resolverá automáticamente a `assets/images/art_01.jpg`.
- También puedes usar `"assets/images/art_01.jpg"` o `"/assets/images/art_01.jpg"`.
- El tamaño y la altura de montaje se calculan automáticamente respetando el aspecto y límites seguros.

### Modificar estilos

La UI (intro, puertas, HUD) está en `style.css`.

## 🌟 Características Avanzadas

- Per‑obra: foco de techo dedicado + luz de relleno local para el lienzo
- Encadre automático al seleccionar obra (bloqueo de vista)
- Cálculo de tamaño por relación de aspecto y margen al suelo
- Distribución de obras a lo largo del pasillo con lados alternos
- LOD de texturas y resolución dinámica de render
- Culling por ventana activa alrededor de la cámara

## 📱 Compatibilidad

- Navegadores modernos (Chrome, Firefox, Safari, Edge)
- Funcionamiento en dispositivos táctiles (controles adaptados)
- Múltiples resoluciones y responsive

## 🚀 Desarrollo y Despliegue

### Desarrollo local

```bash
npm run dev:local
```

URL: `http://localhost:3001`

### Build de producción

```bash
npm run build
```

Salida en `dist/`.

### GitHub Pages

- `vite.config.js` define `base: "/galeria-arte-3d/"` y `homepage` en `package.json` apunta al repositorio.
- Scripts disponibles:

```bash
npm run predeploy   # limpia y construye
npm run deploy      # publica /dist a la rama gh-pages
```

- También hay un workflow de Actions en `.github/workflows/deploy.yml` que construye y publica automáticamente al hacer push a `main`.
- Sitio: `https://juannp.github.io/galeria-arte-3d/`

## 🤝 Contribuciones

Las contribuciones son bienvenidas! Si tienes ideas para mejorar la galería:

1. Fork el proyecto
2. Crea una rama para tu feature
3. Commit tus cambios
4. Push a la rama
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la licencia MIT. Ver el archivo LICENSE para más detalles.

## 🙏 Agradecimientos

- Inspirado en la experiencia de navegación de Wizarding World
- React, Three.js y GSAP
- La comunidad de desarrolladores web 3D

---

**¡Disfruta explorando la galería de arte virtual!** 🎨✨
