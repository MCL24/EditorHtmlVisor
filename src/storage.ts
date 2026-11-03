/**
 * storage.ts — Acceso seguro a localStorage.
 *
 * localStorage puede fallar de varias maneras:
 *   - Modo privado en algunos navegadores (lanza al escribir).
 *   - Cuota llena (QuotaExceededError).
 *   - Cookies/almacenamiento bloqueados por el usuario (lanza al acceder).
 *
 * Por eso TODO acceso pasa por estas funciones, que nunca lanzan:
 * las lecturas devuelven `null` y las escrituras devuelven `false` si fallan.
 */

/** Lee un texto. Devuelve `null` si no existe o si el almacenamiento no está disponible. */
export function readText(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Escribe un texto. Devuelve `true` si se guardó correctamente. */
export function writeText(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Lee y parsea un JSON. Devuelve `null` si no existe, no está disponible o está corrupto. */
export function readJson<T>(key: string): T | null {
  const raw = readText(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Serializa y escribe un JSON. Devuelve `true` si se guardó correctamente. */
export function writeJson(key: string, value: unknown): boolean {
  try {
    return writeText(key, JSON.stringify(value));
  } catch {
    return false;
  }
}
