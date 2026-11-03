/**
 * runtime.ts — Script que se inyecta DENTRO del iframe de la vista previa.
 *
 * El iframe está aislado (sandbox sin `allow-same-origin`), así que la app no
 * puede leer su consola ni su scroll directamente. Este pequeño script corre
 * junto al código del usuario y se comunica con la app por `postMessage`:
 *
 *   iframe → app
 *     { source: 'ehv-preview', type: 'console', level, args }   console.log/info/warn/error/debug
 *     { source: 'ehv-preview', type: 'error', message, location } window.onerror y promesas rechazadas
 *     { source: 'ehv-preview', type: 'scroll', x, y }            posición de scroll actual
 *     { source: 'ehv-preview', type: 'key', key }                teclas que la app necesita (Esc)
 *
 * La posición de scroll a restaurar se pasa como argumento al crear el script,
 * porque cada actualización de `srcdoc` recarga el documento desde cero.
 *
 * ⚠️ `previewRuntime` se convierte a texto con `Function.prototype.toString()`
 * y se ejecuta en otro documento. Por eso debe ser AUTOCONTENIDA: no puede usar
 * imports, variables ni funciones definidas fuera de ella.
 */

/** Marca que identifica los mensajes enviados por el runtime. */
export const RUNTIME_MESSAGE_SOURCE = 'ehv-preview';

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export type RuntimeMessage =
  | { source: typeof RUNTIME_MESSAGE_SOURCE; type: 'console'; level: ConsoleLevel; args: string[] }
  | { source: typeof RUNTIME_MESSAGE_SOURCE; type: 'error'; message: string; location: string }
  | { source: typeof RUNTIME_MESSAGE_SOURCE; type: 'scroll'; x: number; y: number }
  | { source: typeof RUNTIME_MESSAGE_SOURCE; type: 'key'; key: string };

/** Comprueba que un dato recibido por `message` tiene la forma de un mensaje del runtime. */
export function isRuntimeMessage(data: unknown): data is RuntimeMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === RUNTIME_MESSAGE_SOURCE &&
    typeof (data as { type?: unknown }).type === 'string'
  );
}

/**
 * Código que corre dentro del iframe. Ver la advertencia al inicio del archivo.
 * @param sourceTag  valor de `RUNTIME_MESSAGE_SOURCE` (se pasa porque no puede importarse).
 * @param restoreX   scroll horizontal a restaurar al cargar.
 * @param restoreY   scroll vertical a restaurar al cargar.
 */
function previewRuntime(sourceTag: string, restoreX: number, restoreY: number): void {
  const MAX_LENGTH = 2000; // recorta textos enormes para no saturar el panel de consola

  const send = (payload: Record<string, unknown>) => {
    try {
      window.parent.postMessage({ source: sourceTag, ...payload }, '*');
    } catch {
      /* si el mensaje no se puede clonar, se ignora */
    }
  };

  /** Convierte cualquier valor en un texto legible, tolerando referencias circulares. */
  const stringify = (value: unknown): string => {
    let text: string;
    try {
      if (typeof value === 'string') text = value;
      else if (value instanceof Error) text = value.stack || `${value.name}: ${value.message}`;
      else if (value instanceof Element) text = `<${value.tagName.toLowerCase()}${value.id ? ` id="${value.id}"` : ''}>`;
      else if (typeof value === 'function') text = `ƒ ${value.name || '(anónima)'}()`;
      else if (typeof value === 'symbol' || typeof value === 'bigint') text = value.toString();
      else if (value === undefined) text = 'undefined';
      else if (typeof value === 'object' && value !== null) {
        const seen = new WeakSet<object>();
        text = JSON.stringify(
          value,
          (_key, v: unknown) => {
            if (typeof v === 'object' && v !== null) {
              if (seen.has(v)) return '[Circular]';
              seen.add(v);
            }
            if (typeof v === 'bigint') return `${v.toString()}n`;
            if (typeof v === 'function') return `ƒ ${(v as { name?: string }).name || '(anónima)'}()`;
            return v;
          },
          2,
        );
      } else text = String(value);
    } catch {
      text = Object.prototype.toString.call(value);
    }
    return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}… (recortado)` : text;
  };

  // --- Consola ---------------------------------------------------------------
  // Se envuelve cada método: se reenvía a la app y además se sigue llamando al
  // original, para que las DevTools del navegador sigan mostrando los mensajes.
  const levels = ['log', 'info', 'warn', 'error', 'debug'] as const;
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      send({ type: 'console', level, args: args.map(stringify) });
      original(...args);
    };
  }

  // --- Errores no controlados -------------------------------------------------
  window.addEventListener('error', (event) => {
    const where = event.lineno ? `línea ${event.lineno}${event.colno ? `:${event.colno}` : ''}` : '';
    send({ type: 'error', message: event.message || 'Error', location: where });
  });
  window.addEventListener('unhandledrejection', (event) => {
    send({ type: 'error', message: `Promesa rechazada sin capturar: ${stringify(event.reason)}`, location: '' });
  });

  // --- Scroll ------------------------------------------------------------------
  // Restaurar: se intenta varias veces porque la altura final del documento puede
  // cambiar mientras cargan imágenes o fuentes.
  const restore = () => {
    if (restoreX || restoreY) window.scrollTo(restoreX, restoreY);
  };
  document.addEventListener('DOMContentLoaded', restore);
  window.addEventListener('load', restore);

  // Reportar: como mucho una vez por cuadro de animación.
  let scheduled = false;
  window.addEventListener(
    'scroll',
    () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        send({ type: 'scroll', x: window.scrollX, y: window.scrollY });
      });
    },
    { passive: true },
  );

  // --- Teclas ------------------------------------------------------------------
  // Con el foco dentro del iframe, la app no recibe las teclas. Reenviamos Esc
  // para poder salir de la pantalla completa del visor.
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') send({ type: 'key', key: 'Escape' });
  });
}

/**
 * Devuelve la etiqueta `<script>` lista para insertar en el documento del usuario.
 */
export function buildRuntimeScript(scrollX: number, scrollY: number): string {
  const args = [JSON.stringify(RUNTIME_MESSAGE_SOURCE), Math.round(scrollX), Math.round(scrollY)].join(',');
  // El atributo data-* permite reconocer (y si hiciera falta, ignorar) este script desde el documento.
  return `<script data-ehv-runtime>(${previewRuntime.toString()})(${args});</script>`;
}

/**
 * Inserta el script del runtime lo antes posible dentro del HTML del usuario,
 * para que capture la consola ANTES de que se ejecuten sus scripts.
 *
 * Orden de preferencia:
 *   1. Justo después de `<head ...>`.
 *   2. Justo después de `<html ...>`.
 *   3. Justo después de `<!DOCTYPE ...>`.
 *   4. Al principio del documento.
 *
 * Nunca se inserta ANTES del doctype: eso haría que el navegador renderice
 * en "modo quirks" y la vista previa no coincidiría con el archivo exportado.
 */
export function injectRuntime(userHtml: string, script: string): string {
  const patterns = [/<head(\s[^>]*)?>/i, /<html(\s[^>]*)?>/i, /<!doctype[^>]*>/i];
  for (const pattern of patterns) {
    const match = pattern.exec(userHtml);
    if (match) {
      const at = match.index + match[0].length;
      return userHtml.slice(0, at) + script + userHtml.slice(at);
    }
  }
  return script + userHtml;
}
