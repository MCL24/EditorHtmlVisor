/**
 * devices.ts — Selector de dispositivo para probar diseños responsive.
 *
 * Modos:
 *   - Escritorio: el iframe ocupa todo el panel.
 *   - Tablet / Móvil / Personalizado: el iframe tiene un tamaño fijo, se centra
 *     con un marco tipo dispositivo y, si no entra en el panel, se reduce con
 *     `transform: scale()` (el contenido sigue "viendo" el ancho real, así que
 *     las media queries se comportan como en el dispositivo).
 *
 * Cómo se escala sin romper el centrado:
 *   `transform` no cambia el tamaño que el elemento ocupa en el layout. Por eso
 *   hay dos capas:
 *     #device-shell  → mide (ancho × escala) por (alto × escala); es lo que se centra.
 *     #device-frame  → mide ancho × alto reales y se escala desde la esquina superior izquierda.
 *
 * Estructura esperada en index.html:
 *   #preview-stage, #device-shell, #device-frame, #device-select,
 *   #device-custom (contenedor de inputs), #device-width, #device-height,
 *   #device-rotate, #device-dims
 */

import { CUSTOM_SIZE_LIMITS, DEVICE_PRESETS, type DeviceId } from '../config';
import { byId, clamp } from '../utils';

export interface DeviceState {
  device: DeviceId;
  customWidth: number;
  customHeight: number;
  landscape: boolean;
}

/** Margen (px) entre el marco del dispositivo y el borde del panel. */
const STAGE_PADDING = 24;

export class DeviceController {
  private readonly stage = byId('preview-stage');
  private readonly shell = byId('device-shell');
  private readonly frame = byId('device-frame');
  private readonly select = byId<HTMLSelectElement>('device-select');
  private readonly customGroup = byId('device-custom');
  private readonly widthInput = byId<HTMLInputElement>('device-width');
  private readonly heightInput = byId<HTMLInputElement>('device-height');
  private readonly rotateButton = byId<HTMLButtonElement>('device-rotate');
  private readonly dimsLabel = byId('device-dims');
  private state: DeviceState;

  constructor(
    initial: DeviceState,
    private readonly onChange: (state: DeviceState) => void,
  ) {
    this.state = { ...initial };

    // Llenar el <select> a partir de los presets, así las etiquetas viven en un solo lugar (config.ts).
    for (const [id, preset] of Object.entries(DEVICE_PRESETS)) {
      this.select.add(new Option(preset.label, id));
    }
    this.select.value = this.state.device;
    this.widthInput.value = String(this.state.customWidth);
    this.heightInput.value = String(this.state.customHeight);
    this.widthInput.min = this.heightInput.min = String(CUSTOM_SIZE_LIMITS.min);
    this.widthInput.max = this.heightInput.max = String(CUSTOM_SIZE_LIMITS.max);

    this.select.addEventListener('change', () => this.update({ device: this.select.value as DeviceId }));
    this.rotateButton.addEventListener('click', () => this.update({ landscape: !this.state.landscape }));
    // 'change' (no 'input') para no redimensionar con cada dígito mientras se escribe.
    this.widthInput.addEventListener('change', () => this.update({ customWidth: this.readSize(this.widthInput) }));
    this.heightInput.addEventListener('change', () => this.update({ customHeight: this.readSize(this.heightInput) }));

    // Recalcular la escala cuando cambia el tamaño del panel (divisor, ventana, consola…).
    new ResizeObserver(() => this.layout()).observe(this.stage);

    this.layout();
  }

  private update(patch: Partial<DeviceState>): void {
    this.state = { ...this.state, ...patch };
    this.layout();
    this.onChange({ ...this.state });
  }

  /** Lee un input numérico, lo limita al rango permitido y corrige el valor mostrado. */
  private readSize(input: HTMLInputElement): number {
    const fallback = input === this.widthInput ? this.state.customWidth : this.state.customHeight;
    const parsed = Math.round(Number(input.value));
    const value = Number.isFinite(parsed) && parsed > 0 ? clamp(parsed, CUSTOM_SIZE_LIMITS.min, CUSTOM_SIZE_LIMITS.max) : fallback;
    input.value = String(value);
    return value;
  }

  /** Tamaño (sin escalar) del dispositivo actual, o `null` en modo escritorio. */
  private deviceSize(): { width: number; height: number } | null {
    const { device, customWidth, customHeight, landscape } = this.state;
    const preset = DEVICE_PRESETS[device];
    if (preset.width === null || preset.height === null) return null;

    const width = device === 'custom' ? customWidth : preset.width;
    const height = device === 'custom' ? customHeight : preset.height;
    return landscape ? { width: height, height: width } : { width, height };
  }

  /** Aplica tamaños y escala al marco según el estado y el espacio disponible. */
  private layout(): void {
    const size = this.deviceSize();
    const isDesktop = size === null;

    this.stage.dataset.mode = isDesktop ? 'desktop' : 'device';
    this.customGroup.hidden = this.state.device !== 'custom';
    this.rotateButton.disabled = isDesktop;
    this.rotateButton.setAttribute('aria-pressed', String(this.state.landscape && !isDesktop));

    if (isDesktop) {
      this.shell.style.width = this.shell.style.height = '';
      this.frame.style.width = this.frame.style.height = this.frame.style.transform = '';
      const { width, height } = this.stage.getBoundingClientRect();
      this.dimsLabel.textContent = `${Math.round(width)} × ${Math.round(height)}`;
      return;
    }

    const available = this.stage.getBoundingClientRect();
    const scale = Math.min(
      1,
      (available.width - STAGE_PADDING * 2) / size.width,
      (available.height - STAGE_PADDING * 2) / size.height,
    );
    const safeScale = Math.max(scale, 0.05); // evita escalas 0 o negativas con paneles diminutos

    this.frame.style.width = `${size.width}px`;
    this.frame.style.height = `${size.height}px`;
    this.frame.style.transform = safeScale < 1 ? `scale(${safeScale})` : '';
    this.shell.style.width = `${size.width * safeScale}px`;
    this.shell.style.height = `${size.height * safeScale}px`;

    const percent = safeScale < 1 ? ` · ${Math.round(safeScale * 100)}%` : '';
    this.dimsLabel.textContent = `${size.width} × ${size.height}${percent}`;
  }
}
