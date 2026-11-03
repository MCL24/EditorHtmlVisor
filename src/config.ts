/**
 * config.ts — Valores ajustables de la aplicación, reunidos en un solo lugar.
 *
 * Si querés cambiar un tiempo de espera, un límite o un tamaño de dispositivo,
 * este es el único archivo que hay que tocar.
 */

export const CONFIG = {
  /** Espera (ms) desde la última tecla hasta refrescar la vista previa. */
  previewDebounceMs: 300,

  /** Espera (ms) desde la última tecla hasta autoguardar en localStorage. */
  autosaveDebounceMs: 1000,

  /** Tamaño máximo de un archivo importado (5 MB). */
  maxImportBytes: 5 * 1024 * 1024,

  /** Extensiones aceptadas al importar (en minúsculas, con punto). */
  importExtensions: ['.html', '.htm', '.txt'],

  /** Ancho mínimo (px) de cada panel al arrastrar el divisor. */
  minPaneWidthPx: 200,

  /** Por debajo de este ancho (px) se usa el diseño con pestañas. Debe coincidir con el CSS. */
  mobileBreakpointPx: 768,

  /** Tamaño de fuente del editor, en px. */
  fontSize: { min: 10, max: 28, step: 1, default: 14 },

  /** Cantidad máxima de mensajes que conserva el panel de consola. */
  maxConsoleEntries: 500,

  /** Nombre de archivo sugerido al exportar. */
  defaultExportName: 'index.html',

  /**
   * "Localizar en el código" solo se aplica a documentos de hasta este tamaño
   * (en caracteres). Por encima, analizar el HTML en cada actualización se nota.
   */
  sourceMapMaxChars: 1_000_000,

  /** Duración por defecto (ms) de los avisos emergentes. */
  toastDurationMs: 3500,
} as const;

/**
 * Atributo `sandbox` del visor.
 *
 * IMPORTANTE: NO incluir `allow-same-origin`. Sin él, el iframe tiene un origen
 * opaco ("null"), así que el código del usuario no puede leer el localStorage
 * de la app ni acceder a su DOM (window.parent.document lanza un error).
 */
export const PREVIEW_SANDBOX = 'allow-scripts allow-modals allow-forms allow-popups';

/** Claves usadas en localStorage. Todas llevan el prefijo `ehv:` (Editor HTML Visor). */
export const STORAGE_KEYS = {
  content: 'ehv:content',
  settings: 'ehv:settings',
} as const;

/** Identificadores de los dispositivos del selector. */
export type DeviceId = 'desktop' | 'tablet' | 'mobile' | 'custom';

export interface DevicePreset {
  label: string;
  /** `null` = ocupa todo el panel (modo escritorio). */
  width: number | null;
  height: number | null;
}

export const DEVICE_PRESETS: Record<DeviceId, DevicePreset> = {
  desktop: { label: 'Escritorio (100%)', width: null, height: null },
  tablet: { label: 'Tablet (768×1024)', width: 768, height: 1024 },
  mobile: { label: 'Móvil (375×667)', width: 375, height: 667 },
  custom: { label: 'Personalizado', width: 1024, height: 768 },
};

/** Límites para las dimensiones personalizadas. */
export const CUSTOM_SIZE_LIMITS = { min: 100, max: 4000 } as const;
