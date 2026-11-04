/**
 * file-io.ts — Validar y leer archivos, descargar copias, portapapeles y
 * arrastrar y soltar.
 *
 * Todo ocurre localmente en el navegador: los archivos se leen con la API
 * File y se descargan con un enlace a un Blob. Nada se envía a un servidor.
 * Guardar directamente en el disco está en file-system.ts.
 */

import { CONFIG } from './config';

/** Error de validación con un mensaje pensado para mostrarse al usuario. */
export class FileValidationError extends Error {}

/**
 * Valida y lee un archivo como texto UTF-8.
 * Lanza `FileValidationError` si la extensión o el tamaño no son válidos.
 */
export async function readTextFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const validExtension = CONFIG.importExtensions.some((ext) => name.endsWith(ext));
  if (!validExtension) {
    throw new FileValidationError(
      `"${file.name}" no es un tipo de archivo admitido. Usá ${CONFIG.importExtensions.join(', ')}.`,
    );
  }
  if (file.size > CONFIG.maxImportBytes) {
    const limitMb = CONFIG.maxImportBytes / (1024 * 1024);
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    throw new FileValidationError(`"${file.name}" pesa ${sizeMb} MB y el máximo es ${limitMb} MB.`);
  }
  return file.text();
}

/** Descarga `content` como archivo HTML con el nombre indicado. */
export function downloadHtml(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Liberar la URL cuando el navegador ya tomó la descarga.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Normaliza el nombre de archivo de exportación:
 * quita caracteres no válidos en sistemas de archivos y asegura la extensión .html/.htm.
 */
export function normalizeFilename(raw: string): string {
  const cleaned = raw.trim().replace(/[\\/:*?"<>|]+/g, '-');
  if (!cleaned) return CONFIG.defaultExportName;
  return /\.html?$/i.test(cleaned) ? cleaned : `${cleaned}.html`;
}

/** Copia texto al portapapeles. Devuelve `false` si el navegador no lo permite. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Habilita arrastrar y soltar archivos sobre `target`.
 * Mientras se arrastra un archivo encima, `target` recibe el atributo `data-dragging`
 * (el CSS lo usa para mostrar una capa indicativa).
 *
 * `onDrop` recibe el `DataTransfer` y debe leerlo en ese mismo momento:
 * pasado el evento, el navegador lo vacía.
 */
export function setupDropZone(target: HTMLElement, onDrop: (data: DataTransfer) => void): void {
  // Contador para ignorar los dragenter/dragleave que disparan los elementos hijos.
  let depth = 0;
  const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
  const reset = () => {
    depth = 0;
    delete target.dataset.dragging;
  };

  target.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth += 1;
    target.dataset.dragging = 'true';
  });

  target.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    // Sin preventDefault, el navegador no permite soltar y abriría el archivo.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });

  target.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) delete target.dataset.dragging;
  });

  // Fase de captura: interceptamos el drop antes que CodeMirror, que si no
  // insertaría el contenido del archivo en la posición donde se soltó.
  target.addEventListener(
    'drop',
    (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      reset();
      if (event.dataTransfer) onDrop(event.dataTransfer);
    },
    true,
  );
}
