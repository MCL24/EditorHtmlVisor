/**
 * utils.ts — Pequeñas utilidades genéricas sin dependencias de la app.
 */

/**
 * Función "debounced": retrasa la ejecución de `fn` hasta que pasen `waitMs`
 * sin nuevas llamadas. Incluye `flush()` (ejecutar ya lo pendiente) y `cancel()`.
 */
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  flush(): void;
  cancel(): void;
  /** `true` si hay una ejecución pendiente. */
  readonly pending: boolean;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs: number): Debounced<A> {
  let timer: number | undefined;
  let lastArgs: A | undefined;

  const run = () => {
    timer = undefined;
    if (lastArgs) {
      const args = lastArgs;
      lastArgs = undefined;
      fn(...args);
    }
  };

  const debounced = ((...args: A) => {
    lastArgs = args;
    window.clearTimeout(timer);
    timer = window.setTimeout(run, waitMs);
  }) as Debounced<A>;

  debounced.flush = () => {
    window.clearTimeout(timer);
    run();
  };
  debounced.cancel = () => {
    window.clearTimeout(timer);
    timer = undefined;
    lastArgs = undefined;
  };
  Object.defineProperty(debounced, 'pending', { get: () => timer !== undefined });

  return debounced;
}

/** Limita `value` al rango [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Busca un elemento por id y lanza un error claro si no existe.
 * Evita tener que comprobar `null` en cada uso cuando el elemento
 * está garantizado por index.html.
 */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`No se encontró el elemento #${id} en index.html`);
  return el as T;
}

/** `true` si el usuario está en macOS / iOS (para mostrar ⌘ en lugar de Ctrl). */
export const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** Formatea un número con separador de miles en español (p. ej. 12.345). */
export function formatNumber(n: number): string {
  return n.toLocaleString('es');
}
