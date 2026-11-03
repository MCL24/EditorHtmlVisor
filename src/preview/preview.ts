/**
 * preview.ts — Controla el iframe de la vista previa.
 *
 * Responsabilidades:
 *   - Renderizar el HTML del usuario con `iframe.srcdoc` (más el runtime inyectado).
 *   - Recordar la posición de scroll entre actualizaciones.
 *   - Recibir los mensajes del runtime y repartirlos (consola, errores, teclas).
 *   - Abrir la vista previa en una pestaña nueva, manteniendo el aislamiento.
 *
 * Seguridad: el iframe usa `sandbox` SIN `allow-same-origin` (ver PREVIEW_SANDBOX
 * en config.ts). Además, solo se aceptan mensajes cuyo `event.source` sea la
 * ventana de NUESTRO iframe, así ninguna otra ventana puede hacerse pasar por él.
 */

import { PREVIEW_SANDBOX } from '../config';
import { buildRuntimeScript, injectRuntime, isRuntimeMessage, type ConsoleLevel } from './runtime';

export interface PreviewCallbacks {
  /** Mensaje de consola o error no controlado emitido por el código del usuario. */
  onConsole: (level: ConsoleLevel, text: string) => void;
  /** Se llama justo antes de cada renderizado (útil para limpiar la consola). */
  onBeforeRender: () => void;
  /** Tecla reenviada desde dentro del iframe (por ahora solo Escape). */
  onKey: (key: string) => void;
}

export class Preview {
  private readonly iframe: HTMLIFrameElement;
  private readonly callbacks: PreviewCallbacks;
  private scrollX = 0;
  private scrollY = 0;
  /** Último HTML renderizado (sin runtime), para "Recargar" y "Abrir en pestaña nueva". */
  private lastHtml = '';

  constructor(iframe: HTMLIFrameElement, callbacks: PreviewCallbacks) {
    this.iframe = iframe;
    this.callbacks = callbacks;
    // Se fija también desde el código para que no dependa solo de index.html.
    this.iframe.setAttribute('sandbox', PREVIEW_SANDBOX);
    window.addEventListener('message', this.handleMessage);
  }

  /** Renderiza el HTML indicado, conservando la posición de scroll actual. */
  render(userHtml: string): void {
    this.lastHtml = userHtml;
    this.callbacks.onBeforeRender();
    const script = buildRuntimeScript(this.scrollX, this.scrollY);
    this.iframe.srcdoc = injectRuntime(userHtml, script);
  }

  /** Vuelve a renderizar el último HTML (reinicia scripts y estado del documento). */
  reload(): void {
    this.render(this.lastHtml);
  }

  /**
   * Abre el HTML en una pestaña nueva.
   *
   * No se abre el HTML del usuario directamente como Blob URL porque esa URL
   * tendría el MISMO origen que la app y su código podría leer nuestro
   * localStorage. En su lugar se abre una página contenedora mínima que muestra
   * el HTML dentro de un iframe con el mismo sandbox que el visor.
   *
   * Devuelve `false` si el navegador bloqueó la ventana emergente.
   */
  openInNewTab(userHtml: string): boolean {
    const wrapper = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vista previa</title>
<style>html,body{margin:0;height:100%;background:#fff}iframe{border:0;width:100%;height:100%;display:block}</style>
</head>
<body><iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${escapeAttribute(userHtml)}"></iframe></body>
</html>`;
    const url = URL.createObjectURL(new Blob([wrapper], { type: 'text/html' }));
    const win = window.open(url, '_blank');
    // Damos tiempo a que la pestaña cargue antes de liberar la URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return win !== null;
  }

  private readonly handleMessage = (event: MessageEvent) => {
    if (event.source !== this.iframe.contentWindow) return;
    const data: unknown = event.data;
    if (!isRuntimeMessage(data)) return;

    switch (data.type) {
      case 'console':
        this.callbacks.onConsole(data.level, data.args.join(' '));
        break;
      case 'error':
        this.callbacks.onConsole('error', data.location ? `${data.message} (${data.location})` : data.message);
        break;
      case 'scroll':
        this.scrollX = data.x;
        this.scrollY = data.y;
        break;
      case 'key':
        this.callbacks.onKey(data.key);
        break;
    }
  };
}

/** Escapa un texto para usarlo dentro de un atributo HTML entre comillas dobles. */
function escapeAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
