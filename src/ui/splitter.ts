/**
 * splitter.ts — Divisor arrastrable entre el editor y el visor.
 *
 * - Arrastrar (mouse, lápiz o dedo) redimensiona los paneles.
 * - Doble clic vuelve a 50/50.
 * - Con el foco en el divisor, ← / → lo mueven y Inicio / Fin van a los extremos.
 * - Ningún panel queda por debajo de `CONFIG.minPaneWidthPx`.
 *
 * La proporción se aplica con la variable CSS `--split` sobre el contenedor
 * (ver layout.css), y se informa con `onChange` para que se guarde.
 */

import { CONFIG } from '../config';
import { clamp } from '../utils';

/** Paso (fracción del ancho) al mover el divisor con el teclado. */
const KEYBOARD_STEP = 0.02;

export class Splitter {
  private ratio: number;

  constructor(
    private readonly container: HTMLElement,
    private readonly handle: HTMLElement,
    initialRatio: number,
    private readonly onChange: (ratio: number) => void,
  ) {
    this.ratio = initialRatio;
    this.apply(initialRatio);

    handle.addEventListener('pointerdown', this.startDrag);
    handle.addEventListener('dblclick', () => this.set(0.5));
    handle.addEventListener('keydown', this.handleKey);

    // Si la ventana se achica, volver a validar la proporción contra los mínimos.
    window.addEventListener('resize', () => this.apply(this.ratio));
  }

  /** Fija la proporción (0–1), respetando los mínimos, y la notifica. */
  set(ratio: number): void {
    this.apply(ratio);
    this.onChange(this.ratio);
  }

  /** Aplica la proporción sin notificar. */
  private apply(ratio: number): void {
    this.ratio = this.clampRatio(ratio);
    this.container.style.setProperty('--split', String(this.ratio));
    this.handle.setAttribute('aria-valuenow', String(Math.round(this.ratio * 100)));
  }

  /** Limita la proporción para que ambos paneles midan al menos el mínimo configurado. */
  private clampRatio(ratio: number): number {
    const width = this.container.clientWidth - this.handle.offsetWidth;
    if (width <= 0) return clamp(ratio, 0.05, 0.95);
    const minFraction = Math.min(CONFIG.minPaneWidthPx / width, 0.5);
    return clamp(ratio, minFraction, 1 - minFraction);
  }

  private readonly startDrag = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();

    // Capturar el puntero: los eventos siguen llegando aunque pase por encima del iframe.
    this.handle.setPointerCapture(event.pointerId);
    // Mientras se arrastra, el CSS desactiva la interacción con el iframe y la selección de texto.
    document.body.classList.add('is-resizing');

    const rect = this.container.getBoundingClientRect();
    const onMove = (e: PointerEvent) => this.apply((e.clientX - rect.left) / rect.width);
    const onUp = () => {
      this.handle.removeEventListener('pointermove', onMove);
      this.handle.removeEventListener('pointerup', onUp);
      this.handle.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('is-resizing');
      this.onChange(this.ratio); // guardar una sola vez, al soltar
    };

    this.handle.addEventListener('pointermove', onMove);
    this.handle.addEventListener('pointerup', onUp);
    this.handle.addEventListener('pointercancel', onUp);
  };

  private readonly handleKey = (event: KeyboardEvent) => {
    const actions: Record<string, () => number> = {
      ArrowLeft: () => this.ratio - KEYBOARD_STEP,
      ArrowRight: () => this.ratio + KEYBOARD_STEP,
      Home: () => 0,
      End: () => 1,
    };
    const next = actions[event.key];
    if (!next) return;
    event.preventDefault();
    this.set(next());
  };
}
