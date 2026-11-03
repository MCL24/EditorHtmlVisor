/**
 * statusbar.ts — Barra de estado inferior.
 *
 * Muestra: posición del cursor, cantidad de caracteres, estado de guardado e
 * indicador de errores/avisos de la consola del visor. Hacer clic en el
 * indicador de consola despliega el panel de consola.
 */

import type { ConsoleCounts } from '../preview/console-panel';
import { byId, formatNumber } from '../utils';

/**
 * Estados de guardado:
 *   saved    → el autoguardado escribió la última versión.
 *   pending  → hay cambios esperando el próximo autoguardado.
 *   failed   → localStorage no está disponible o está lleno.
 */
export type SaveState = 'saved' | 'pending' | 'failed';

const SAVE_LABELS: Record<SaveState, string> = {
  saved: 'Guardado',
  pending: 'Cambios sin guardar',
  failed: 'Sin autoguardado',
};

const SAVE_TITLES: Record<SaveState, string> = {
  saved: 'El contenido está guardado en este navegador.',
  pending: 'Se guardará automáticamente en un momento.',
  failed: 'No se pudo guardar en este navegador (¿modo privado o almacenamiento lleno?). Exportá el archivo para no perder cambios.',
};

export class StatusBar {
  private readonly cursor = byId('status-cursor');
  private readonly length = byId('status-length');
  private readonly save = byId('status-save');
  private readonly consoleButton = byId<HTMLButtonElement>('status-console');

  constructor(onConsoleClick: () => void) {
    this.consoleButton.addEventListener('click', onConsoleClick);
  }

  setCursor(line: number, column: number): void {
    this.cursor.textContent = `Lín ${formatNumber(line)}, Col ${formatNumber(column)}`;
  }

  setLength(chars: number): void {
    this.length.textContent = `${formatNumber(chars)} ${chars === 1 ? 'carácter' : 'caracteres'}`;
  }

  setSaveState(state: SaveState): void {
    this.save.textContent = SAVE_LABELS[state];
    this.save.title = SAVE_TITLES[state];
    this.save.dataset.state = state;
  }

  setConsoleCounts({ errors, warnings }: ConsoleCounts): void {
    const parts: string[] = [];
    if (errors) parts.push(`${errors} ${errors === 1 ? 'error' : 'errores'}`);
    if (warnings) parts.push(`${warnings} ${warnings === 1 ? 'aviso' : 'avisos'}`);
    this.consoleButton.textContent = parts.length ? parts.join(' · ') : 'Sin errores';
    this.consoleButton.dataset.state = errors ? 'error' : warnings ? 'warn' : 'ok';
  }
}
