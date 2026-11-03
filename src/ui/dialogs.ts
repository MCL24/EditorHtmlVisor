/**
 * dialogs.ts — Ventanas modales basadas en el elemento nativo <dialog>.
 *
 * Usar <dialog> con `showModal()` nos da gratis:
 *   - Cierre con Esc.
 *   - Foco atrapado dentro del diálogo y devuelto al cerrar.
 *   - Fondo inerte (no se puede interactuar con la app detrás).
 *
 * Diálogos (definidos en index.html):
 *   #confirm-dialog   confirmación genérica (Muestra, Limpiar)
 *   #export-dialog    nombre del archivo + descargar / copiar
 *   #help-dialog      atajos y guía de uso
 */

import { byId } from '../utils';

/** Cierra el diálogo al hacer clic en el fondo oscuro (fuera de su contenido). */
function closeOnBackdropClick(dialog: HTMLDialogElement): void {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close('cancel');
  });
}

/** Prepara los comportamientos comunes a todos los diálogos. Llamar una vez al iniciar. */
export function setupDialogs(): void {
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog')) {
    closeOnBackdropClick(dialog);
    // Botones con data-close cierran su diálogo.
    for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-close]')) {
      button.addEventListener('click', () => dialog.close('cancel'));
    }
  }
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Estilo destructivo (botón rojo) para acciones que borran contenido. */
  danger?: boolean;
}

/**
 * Pide confirmación al usuario. Resuelve `true` si acepta y `false` si cancela
 * (botón Cancelar, Esc o clic fuera).
 */
export function confirmDialog({ title, message, confirmLabel = 'Aceptar', danger = false }: ConfirmOptions): Promise<boolean> {
  const dialog = byId<HTMLDialogElement>('confirm-dialog');
  byId('confirm-title').textContent = title;
  byId('confirm-message').textContent = message;
  const okButton = byId<HTMLButtonElement>('confirm-ok');
  okButton.textContent = confirmLabel;
  okButton.classList.toggle('btn--danger', danger);

  return new Promise((resolve) => {
    const onOk = () => dialog.close('ok');
    okButton.addEventListener('click', onOk);
    dialog.addEventListener(
      'close',
      () => {
        okButton.removeEventListener('click', onOk);
        resolve(dialog.returnValue === 'ok');
      },
      { once: true },
    );
    dialog.returnValue = '';
    dialog.showModal();
    okButton.focus();
  });
}

/** Abre un diálogo por id (por ejemplo, la ayuda). */
export function openDialog(id: string): void {
  const dialog = byId<HTMLDialogElement>(id);
  if (!dialog.open) dialog.showModal();
}

/** `true` si hay algún diálogo modal abierto. */
export function isAnyDialogOpen(): boolean {
  return document.querySelector('dialog[open]') !== null;
}
