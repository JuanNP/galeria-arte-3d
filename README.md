# Galería de Arte 3D - Experiencia Inmersiva

Una galería de arte virtual 3D interactiva inspirada en la experiencia de navegación de Wizarding World, donde puedes explorar diferentes salas y obras de arte en un entorno inmersivo.

## 🎨 Características

- **Navegación 3D inmersiva** con controles intuitivos
- **5 salas temáticas** diferentes (Entrada, Renacimiento, Impresionismo, Arte Moderno, Contemporáneo)
- **Obras de arte interactivas** con información detallada
- **Iluminación dinámica** y efectos visuales
- **Interfaz elegante** con controles de navegación
- **Diseño responsivo** para diferentes dispositivos

## 🚀 Instalación

1. **Clona o descarga** este proyecto
2. **Instala las dependencias**:
   ```bash
   npm install
   ```
3. **Ejecuta el servidor de desarrollo**:
   ```bash
   npm run dev
   ```
4. **Abre tu navegador** en `http://localhost:3000`

## 🎮 Controles

### Navegación Básica
- **WASD** - Mover la cámara
- **Mouse** - Girar la vista (clic y arrastrar)
- **Scroll** - Zoom in/out
- **Flechas Izquierda/Derecha** - Navegar entre salas
- **Espacio** - Seleccionar obra más cercana

### Interfaz
- **Botones de sala** - Navegación rápida entre salas
- **Toggle UI** - Ocultar/mostrar interfaz
- **Reset Cámara** - Volver a la posición inicial

## 🏗️ Estructura del Proyecto

```
galeria-arte-3d/
├── index.html          # Página principal
├── style.css           # Estilos CSS
├── main.js             # Lógica principal 3D
├── package.json        # Dependencias del proyecto
├── vite.config.js      # Configuración de Vite
├── assets/             # Recursos del proyecto
│   ├── images/         # Imágenes
│   ├── models/         # Modelos 3D
│   └── textures/       # Texturas
└── README.md           # Este archivo
```

## 🛠️ Tecnologías Utilizadas

- **Three.js** - Motor de gráficos 3D
- **GSAP** - Animaciones y transiciones
- **Vite** - Servidor de desarrollo y build
- **CSS3** - Estilos modernos y responsivos
- **JavaScript ES6+** - Lógica de la aplicación

## 🎯 Personalización

### Agregar Nuevas Obras de Arte

Para agregar una nueva obra, modifica el array `artworkData` en `main.js`:

```javascript
{
    title: "Título de la Obra",
    artist: "Nombre del Artista",
    description: "Descripción de la obra...",
    room: "nombre_sala",
    position: [x, y, z],
    size: [ancho, alto]
}
```

### Crear Nuevas Salas

Para crear una nueva sala, agrega la lógica en los métodos `createRooms()` y `getRoomPosition()`.

### Modificar Estilos

Los estilos están en `style.css` y pueden ser personalizados fácilmente para cambiar colores, fuentes y layout.

## 🌟 Características Avanzadas

- **Sistema de iluminación dinámica** con luces puntuales
- **Efectos de hover** en las obras de arte
- **Transiciones suaves** entre salas
- **Animaciones de cámara** automáticas
- **Sistema de partículas** para efectos atmosféricos
- **Optimización de rendimiento** con frustum culling

## 📱 Compatibilidad

- **Navegadores modernos** (Chrome, Firefox, Safari, Edge)
- **Dispositivos táctiles** con controles adaptados
- **Diferentes resoluciones** de pantalla
- **Modo responsivo** para móviles y tablets

## 🚀 Despliegue

Para crear una versión de producción:

```bash
npm run build
```

Los archivos se generarán en la carpeta `dist/` lista para subir a cualquier servidor web.

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
- Three.js por el motor 3D
- GSAP por las animaciones
- La comunidad de desarrolladores web 3D

---

**¡Disfruta explorando la galería de arte virtual!** 🎨✨
