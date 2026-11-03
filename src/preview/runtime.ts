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
 *     { source: 'ehv-preview', type: 'selection', start, end }   texto seleccionado (ver source-map.ts)
 *
 *   app → iframe
 *     { source: 'ehv-app', type: 'print' }   imprimir solo el documento del visor (Exportar → PDF)
 *
 * La posición de scroll a restaurar se pasa como argumento al crear el script,
 * porque cada actualización de `srcdoc` recarga el documento desde cero.
 *
 * ⚠️ `previewRuntime` se convierte a texto con `Function.prototype.toString()`
 * y se ejecuta en otro documento. Por eso debe ser AUTOCONTENIDA: no puede usar
 * imports, variables ni funciones definidas fuera de ella.
 */

import { SOURCE_ATTRIBUTE } from './source-map';

/** Marca que identifica los mensajes enviados por el runtime. */
export const RUNTIME_MESSAGE_SOURCE = 'ehv-preview';

/** Marca que identifica los mensajes que la app envía al runtime. */
export const APP_MESSAGE_SOURCE = 'ehv-app';

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export type RuntimeMessage =
  | { source: typeof RUNTIME_MESSAGE_SOURCE; type: 'console'; level: ConsoleLevel; args: string[] }
  | { source: typeof RUNTIME_MESSAGE_SOURCE; type: 'error'; message: string; location: string }
  | { source: typeof RUNTIME_MESSAGE_SOURCE; type: 'scroll'; x: number; y: number }
  | { source: typeof RUNTIME_MESSAGE_SOURCE; type: 'key'; key: string }
  | {
      source: typeof RUNTIME_MESSAGE_SOURCE;
      type: 'selection';
      /** Ambos `null` cuando la selección se vació. */
      start: SelectionEndpoint | null;
      end: SelectionEndpoint | null;
    };

/**
 * Descripción de un extremo de la selección del visor, lo bastante precisa
 * para encontrarlo en el código fuente (ver preview/source-map.ts).
 */
export interface SelectionEndpoint {
  /** Valor de `data-ehv-src` del elemento anotado más cercano (posición de su `<` en el código). */
  src: number;
  /** Índice del hueco de texto dentro de ese elemento, o -1 si no se pudo determinar. */
  gap: number;
  /** Texto seleccionado dentro del nodo de texto (vacío si el extremo cae en un borde de elemento). */
  text: string;
  /** Cantidad de caracteres del nodo de texto antes de `text` (para elegir entre textos repetidos). */
  before: number;
  /** Si no hay texto: usar el inicio o el final del elemento. */
  edge: 'start' | 'end';
}

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
 * @param sourceAttr nombre del atributo con la posición en el código (`data-ehv-src`).
 * @param appTag     valor de `APP_MESSAGE_SOURCE` (mensajes que llegan desde la app).
 */
function previewRuntime(
  sourceTag: string,
  restoreX: number,
  restoreY: number,
  sourceAttr: string,
  appTag: string,
): void {
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

  // --- Selección (Localizar en el código) -------------------------------------
  // Cada extremo de la selección se describe con el elemento anotado que lo
  // contiene y el texto seleccionado. La app lo traduce a una posición del código.
  const MAX_SELECTION_TEXT = 300; // basta para ubicar el texto sin enviar páginas enteras

  /** Índice del hueco de texto donde está `node` (cuántos elementos/comentarios hermanos lo preceden). */
  const gapIndex = (node: Node): number => {
    let index = 0;
    for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) {
      if (sibling.nodeType === Node.ELEMENT_NODE || sibling.nodeType === Node.COMMENT_NODE) index += 1;
    }
    return index;
  };

  const describeEndpoint = (container: Node, offset: number, side: 'start' | 'end') => {
    let node: Node = container;
    let text = '';
    let before = 0;
    let edge: 'start' | 'end' = side;

    if (container.nodeType === Node.TEXT_NODE) {
      // Caso habitual: el extremo está dentro de un texto.
      const data = (container as Text).data;
      const from = side === 'start' ? offset : Math.max(0, offset - MAX_SELECTION_TEXT);
      const to = side === 'start' ? Math.min(data.length, offset + MAX_SELECTION_TEXT) : offset;
      text = data.slice(from, to);
      before = from;
    } else {
      // El extremo está entre dos hijos de un elemento: tomar el hijo vecino.
      const child = side === 'start' ? container.childNodes[offset] : container.childNodes[offset - 1];
      if (child) {
        node = child;
        if (child.nodeType === Node.TEXT_NODE) {
          const data = (child as Text).data;
          text = side === 'start' ? data.slice(0, MAX_SELECTION_TEXT) : data.slice(-MAX_SELECTION_TEXT);
          before = side === 'start' ? 0 : Math.max(0, data.length - MAX_SELECTION_TEXT);
        }
      } else {
        // Sin hijo vecino: el extremo está al principio o al final del contenedor.
        edge = side === 'start' ? 'end' : 'start';
      }
    }

    const isText = node.nodeType === Node.TEXT_NODE;
    const owner = isText ? node.parentElement : (node as Element);
    const annotated = owner?.closest?.('[' + sourceAttr + ']');
    if (!annotated) return null;

    return {
      src: Number(annotated.getAttribute(sourceAttr)),
      // El hueco solo tiene sentido si el texto es hijo directo del elemento anotado.
      gap: isText && node.parentElement === annotated ? gapIndex(node) : -1,
      text: isText ? text : '',
      before,
      edge,
    };
  };

  let selectionTimer = 0;
  let hadSelection = false;
  document.addEventListener('selectionchange', () => {
    // Esperar a que el usuario termine de arrastrar antes de informar.
    clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(() => {
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        if (hadSelection) send({ type: 'selection', start: null, end: null });
        hadSelection = false;
        return;
      }
      const range = selection.getRangeAt(0);
      hadSelection = true;
      send({
        type: 'selection',
        start: describeEndpoint(range.startContainer, range.startOffset, 'start'),
        end: describeEndpoint(range.endContainer, range.endOffset, 'end'),
      });
    }, 150);
  });

  // --- Imprimir (Exportar → PDF) ----------------------------------------------
  // Llamar a print() desde DENTRO del iframe imprime solo este documento, sin
  // la interfaz de la app. Requiere `allow-modals` en el sandbox.
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return; // solo la app puede pedirlo
    const data = event.data as { source?: unknown; type?: unknown } | null;
    if (!data || data.source !== appTag || data.type !== 'print') return;

    // Por defecto los navegadores no imprimen colores ni imágenes de fondo.
    // Se les pide que los respeten, para que el PDF se vea como el visor. Como
    // la propiedad se hereda, cualquier regla propia del usuario tiene prioridad.
    const style = document.createElement('style');
    style.textContent = 'html{-webkit-print-color-adjust:exact;print-color-adjust:exact}';
    (document.head || document.documentElement).appendChild(style);
    window.addEventListener('afterprint', () => style.remove(), { once: true });

    window.print();
  });
}

/**
 * Devuelve la etiqueta `<script>` lista para insertar en el documento del usuario.
 */
export function buildRuntimeScript(scrollX: number, scrollY: number): string {
  const args = [
    JSON.stringify(RUNTIME_MESSAGE_SOURCE),
    Math.round(scrollX),
    Math.round(scrollY),
    JSON.stringify(SOURCE_ATTRIBUTE),
    JSON.stringify(APP_MESSAGE_SOURCE),
  ].join(',');
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
