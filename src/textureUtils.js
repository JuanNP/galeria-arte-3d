/**
 * Calcula el tamaño (entero) al que reescalar una imagen para que su lado
 * largo no exceda `max`, preservando el aspecto. Si ya cabe, devuelve igual.
 */
export function computeDownscaleSize(w, h, max) {
  if (w <= max && h <= max) return { width: w, height: h };
  const scale = max / Math.max(w, h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}
