/**
 * shortcuts.ts — Atajos de teclado globales.
 *
 * Se escuchan en la fase de CAPTURA de `window`, es decir, antes de que el
 * evento llegue al editor. Así tenemos un único lugar que decide qué hace cada
 * atajo, y evitamos que CodeMirror lo interprete distinto (por ejemplo,
 * CodeMirror usa Ctrl+Enter para insertar una línea en blanco).
 *
 * Atajos que NO están acá porque los resuelve CodeMirror con el foco en el editor:
 *   - Ctrl/Cmd+/  comentar/descomentar
 *   - Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z  deshacer/rehacer
 *   - Ctrl/Cmd+D  seleccionar la siguiente coincidencia (múltiples cursores)
 *
 * Limitación: con el foco DENTRO del iframe, la app no recibe las teclas (el
 * iframe es otro documento). Solo Esc se reenvía desde el runtime del visor.
 */

import { isAnyDialogOpen } from './ui/dialogs';

export interface ShortcutActions {
  exportFile: () => void;
  refreshPreview: () => void;
  format: () => void;
  search: () => void;
  /** Devuelve `true` si consumió el Esc (p. ej. salió de pantalla completa). */
  escape: () => boolean;
}

export function registerShortcuts(actions: ShortcutActions): void {
  window.addEventListener(
    'keydown',
    (event) => {
      // Con un diálogo abierto, los atajos de la app quedan en pausa: el diálogo
      // maneja sus propias teclas (incluido Esc para cerrarse).
      if (isAnyDialogOpen()) return;

      // Cmd en macOS, Ctrl en el resto.
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      let handler: (() => void) | null = null;

      if (mod && !event.shiftKey && !event.altKey && key === 's') handler = actions.exportFile;
      else if (mod && key === 'enter') handler = actions.refreshPreview;
      else if (event.shiftKey && event.altKey && !mod && event.code === 'KeyF') handler = actions.format;
      else if (mod && !event.shiftKey && !event.altKey && key === 'f') handler = actions.search;
      else if (event.key === 'Escape') {
        // Esc solo se consume si había algo que cerrar; si no, sigue su curso
        // (por ejemplo, para cerrar el panel de búsqueda de CodeMirror).
        if (actions.escape()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (!handler) return;
      event.preventDefault(); // p. ej. evita el "Guardar página" del navegador con Ctrl+S
      event.stopPropagation();
      handler();
    },
    { capture: true },
  );
}
