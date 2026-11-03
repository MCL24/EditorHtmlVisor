/**
 * toast.ts — Avisos emergentes breves ("toasts") en la esquina inferior.
 *
 * Uso:
 *   showToast('Archivo importado', 'success');
 *   showToast('No se pudo formatear: …', 'error', 6000);
 *
 * El contenedor `#toasts` tiene `aria-live="polite"`, así que los lectores de
 * pantalla anuncian cada aviso sin interrumpir.
 */

import { CONFIG } from '../config';
import { byId } from '../utils';

export type ToastType = 'info' | 'success' | 'error';

export function showToast(message: string, type: ToastType = 'info', durationMs: number = CONFIG.toastDurationMs): void {
  const container = byId('toasts');

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.textContent = message;

  // Cualquier aviso se puede cerrar con un clic antes de tiempo.
  toast.addEventListener('click', () => dismiss());

  container.append(toast);

  let removed = false;
  const dismiss = () => {
    if (removed) return;
    removed = true;
    toast.classList.add('toast--leaving');
    // Esperar la animación de salida; el timeout es un respaldo por si no hay animación.
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    window.setTimeout(() => toast.remove(), 400);
  };

  window.setTimeout(dismiss, durationMs);
}
