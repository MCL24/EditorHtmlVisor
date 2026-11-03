/**
 * settings.ts — Preferencias del usuario que se recuerdan entre sesiones.
 *
 * Se guardan todas juntas como un único objeto JSON bajo `STORAGE_KEYS.settings`.
 * El contenido del editor NO va acá: se guarda aparte (ver main.ts) porque cambia
 * con mucha más frecuencia y puede ser grande.
 */

import { CONFIG, DEVICE_PRESETS, STORAGE_KEYS, type DeviceId } from './config';
import { readJson, writeJson } from './storage';
import { clamp } from './utils';

export type ThemeName = 'light' | 'dark';

export interface Settings {
  /** Tema elegido explícitamente. `null` = seguir `prefers-color-scheme` del sistema. */
  theme: ThemeName | null;
  /** Fracción (0–1) del ancho que ocupa el panel del editor. */
  splitRatio: number;
  device: DeviceId;
  customWidth: number;
  customHeight: number;
  /** `true` = orientación horizontal (ancho y alto intercambiados). */
  landscape: boolean;
  autoUpdate: boolean;
  wordWrap: boolean;
  fontSize: number;
  /** Panel de consola desplegado. */
  consoleOpen: boolean;
  /** "Localizar en el código": seleccionar texto en el visor resalta su código. */
  locateSource: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: null,
  splitRatio: 0.5,
  device: 'desktop',
  customWidth: DEVICE_PRESETS.custom.width ?? 1024,
  customHeight: DEVICE_PRESETS.custom.height ?? 768,
  landscape: false,
  autoUpdate: true,
  wordWrap: false,
  fontSize: CONFIG.fontSize.default,
  consoleOpen: false,
  locateSource: true,
};

/**
 * Carga las preferencias guardadas, mezcladas con los valores por defecto.
 * Así, si en una versión futura se agrega una preferencia nueva, los usuarios
 * existentes reciben su valor por defecto en lugar de `undefined`.
 */
export function loadSettings(): Settings {
  const saved = readJson<Partial<Settings>>(STORAGE_KEYS.settings);
  const merged: Settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };

  // Validaciones mínimas por si el JSON guardado fue editado a mano o está dañado.
  if (!(merged.device in DEVICE_PRESETS)) merged.device = DEFAULT_SETTINGS.device;
  if (typeof merged.splitRatio !== 'number' || merged.splitRatio <= 0 || merged.splitRatio >= 1) {
    merged.splitRatio = DEFAULT_SETTINGS.splitRatio;
  }
  merged.fontSize = clamp(Number(merged.fontSize) || CONFIG.fontSize.default, CONFIG.fontSize.min, CONFIG.fontSize.max);
  if (merged.theme !== 'light' && merged.theme !== 'dark') merged.theme = null;

  return merged;
}

/** Guarda el objeto completo de preferencias. Devuelve `false` si el almacenamiento falló. */
export function saveSettings(settings: Settings): boolean {
  return writeJson(STORAGE_KEYS.settings, settings);
}
