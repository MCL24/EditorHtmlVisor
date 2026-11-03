/**
 * console-panel.ts — Panel de consola colapsable bajo el visor.
 *
 * Muestra los mensajes que el código del usuario envía con console.* y los
 * errores no controlados. Se limpia automáticamente en cada actualización del
 * visor, porque el documento se recarga y vuelve a emitir sus mensajes.
 *
 * Estructura esperada en index.html:
 *   #console            contenedor (atributo data-open="true|false")
 *   #console-toggle     botón que despliega/colapsa
 *   #console-clear      botón "Limpiar consola"
 *   #console-count      contador visible en la cabecera
 *   #console-list       <ol> donde se agregan los mensajes
 */

import { CONFIG } from '../config';
import type { ConsoleLevel } from './runtime';
import { byId } from '../utils';

export interface ConsoleCounts {
  errors: number;
  warnings: number;
  total: number;
}

const LEVEL_LABELS: Record<ConsoleLevel, string> = {
  log: 'log',
  info: 'info',
  warn: 'aviso',
  error: 'error',
  debug: 'debug',
};

export class ConsolePanel {
  private readonly root = byId('console');
  private readonly toggleButton = byId<HTMLButtonElement>('console-toggle');
  private readonly countLabel = byId('console-count');
  private readonly list = byId<HTMLOListElement>('console-list');
  private counts: ConsoleCounts = { errors: 0, warnings: 0, total: 0 };

  /**
   * @param initiallyOpen   estado inicial (desplegado o no).
   * @param onCountsChange  se llama cuando cambian los contadores (para la barra de estado).
   * @param onToggle        se llama al desplegar/colapsar (para guardar la preferencia).
   */
  constructor(
    initiallyOpen: boolean,
    private readonly onCountsChange: (counts: ConsoleCounts) => void,
    private readonly onToggle: (open: boolean) => void,
  ) {
    this.setOpen(initiallyOpen);
    this.toggleButton.addEventListener('click', () => this.setOpen(!this.isOpen));
    byId('console-clear').addEventListener('click', () => this.clear());
    this.render();
  }

  get isOpen(): boolean {
    return this.root.dataset.open === 'true';
  }

  setOpen(open: boolean): void {
    this.root.dataset.open = String(open);
    this.toggleButton.setAttribute('aria-expanded', String(open));
    this.onToggle(open);
  }

  add(level: ConsoleLevel, text: string): void {
    const item = document.createElement('li');
    item.className = `console__entry console__entry--${level}`;

    const badge = document.createElement('span');
    badge.className = 'console__level';
    badge.textContent = LEVEL_LABELS[level];

    const message = document.createElement('pre');
    message.className = 'console__message';
    // textContent (no innerHTML): el texto viene del código del usuario y no debe interpretarse.
    message.textContent = text;

    item.append(badge, message);
    this.list.append(item);

    // Limitar la cantidad de mensajes para no degradar el rendimiento con bucles de console.log.
    while (this.list.childElementCount > CONFIG.maxConsoleEntries) this.list.firstElementChild?.remove();

    this.counts.total += 1;
    if (level === 'error') this.counts.errors += 1;
    if (level === 'warn') this.counts.warnings += 1;
    this.render();

    // Mantener visible el último mensaje.
    this.list.scrollTop = this.list.scrollHeight;
  }

  clear(): void {
    this.list.replaceChildren();
    this.counts = { errors: 0, warnings: 0, total: 0 };
    this.render();
  }

  private render(): void {
    const { total, errors, warnings } = this.counts;
    this.countLabel.textContent = String(total);
    this.countLabel.dataset.state = errors > 0 ? 'error' : warnings > 0 ? 'warn' : 'none';
    this.list.dataset.empty = String(total === 0);
    this.onCountsChange({ ...this.counts });
  }
}
