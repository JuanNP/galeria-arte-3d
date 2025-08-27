import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    open: true,
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
  // Sin base path para desarrollo local
  base: "/",
  resolve: {
    alias: {
      "@assets": resolve(__dirname, "assets"),
      "@src": resolve(__dirname, "src"),
    },
  },
  // Los archivos en assets/ se sirven desde la raíz
  publicDir: "assets",
  // Configuración adicional para servir assets correctamente
  assetsInclude: ["**/*.jpg", "**/*.png", "**/*.jpeg", "**/*.gif", "**/*.webp"],
});
