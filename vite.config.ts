import { defineConfig } from 'vite';

/**
 * Configuración de Vite.
 *
 * - `base: './'` genera rutas relativas para que el build funcione
 *   aunque se sirva desde una subcarpeta o se abra con un servidor estático simple.
 * - Prettier se carga con `import()` dinámico (ver src/editor/formatter.ts), así que
 *   Vite lo separa automáticamente en un chunk aparte que solo se descarga
 *   la primera vez que el usuario pulsa "Formatear".
 */
export default defineConfig({
  base: './',
  css: {
    // Configuración PostCSS vacía e inline: evita que Vite busque un archivo
    // postcss.config.* recorriendo las carpetas superiores (puede ser muy lento).
    postcss: {},
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // El chunk principal (~600 kB sin comprimir, ~200 kB gzip) es casi todo CodeMirror,
    // que se necesita desde el primer instante. Subimos el umbral del aviso para que
    // no aparezca en cada build; Prettier ya va en chunks aparte (carga diferida).
    chunkSizeWarningLimit: 700,
  },
});
