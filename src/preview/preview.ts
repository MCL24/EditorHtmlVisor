/**
 * preview.ts — Controla el iframe de la vista previa.
 *
 * Responsabilidades:
 *   - Renderizar el HTML del usuario con `iframe.srcdoc` (más el runtime inyectado).
 *   - Recordar la posición de scroll entre actualizaciones.
 *   - Recibir los mensajes del runtime y repartirlos (consola, errores, teclas).
 *   - Abrir la vista previa en una pestaña nueva, manteniendo el aislamiento.
 *   - Imprimir solo el documento del visor (Exportar → PDF).
 *   - "Localizar en el código": anotar el HTML antes de renderizar y traducir
 *     las selecciones del visor a rangos del código (ver source-map.ts).
 *
 * Seguridad: el iframe usa `sandbox` SIN `allow-same-origin` (ver PREVIEW_SANDBOX
 * en config.ts). Además, solo se aceptan mensajes cuyo `event.source` sea la
 * ventana de NUESTRO iframe, así ninguna otra ventana puede hacerse pasar por él.
 */

import { CONFIG, PREVIEW_SANDBOX } from '../config';
import { APP_MESSAGE_SOURCE, buildRuntimeScript, injectRuntime, isRuntimeMessage, type ConsoleLevel } from './runtime';
import { annotateSource, locateSelection, type SourceRange, type SourceSnapshot } from './source-map';

export interface PreviewCallbacks {
  /** Mensaje de consola o error no controlado emitido por el código del usuario. */
  onConsole: (level: ConsoleLevel, text: string) => void;
  /** Se llama justo antes de cada renderizado (útil para limpiar la consola). */
  onBeforeRender: () => void;
  /** Tecla reenviada desde dentro del iframe (por ahora solo Escape). */
  onKey: (key: string) => void;
  /**
   * Cambió la selección de texto en el visor (solo con "Localizar en el código" activo).
   * @param range           rango del código que la produce, o `null` si se deseleccionó o no se pudo ubicar.
   * @param renderedSource  código con el que se renderizó; si ya no coincide con el editor, el rango no es válido.
   */
  onSourceSelection: (range: SourceRange | null, renderedSource: string) => void;
}

export class Preview {
  private readonly iframe: HTMLIFrameElement;
  private readonly callbacks: PreviewCallbacks;
  private scrollX = 0;
  private scrollY = 0;
  /** Último HTML renderizado (sin runtime), para "Recargar" y "Abrir en pestaña nueva". */
  private lastHtml = '';
  /** Si está activo, el HTML se anota para poder localizar selecciones. */
  private locateEnabled = false;
  /** Árbol sintáctico del último render anotado; `null` si no se anotó. */
  private snapshot: SourceSnapshot | null = null;
  private hasRendered = false;
  /** Se resuelve cuando el iframe terminó de cargar el último render. */
  private loaded: Promise<void> = Promise.resolve();

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
    this.hasRendered = true;
    this.callbacks.onBeforeRender();

    // Anotar solo si la función está activa y el documento no es enorme
    // (analizar varios MB en cada tecla haría lenta la escritura).
    let html = userHtml;
    this.snapshot = null;
    if (this.locateEnabled && userHtml.length <= CONFIG.sourceMapMaxChars) {
      const annotated = annotateSource(userHtml);
      html = annotated.html;
      this.snapshot = annotated.snapshot;
    }

    const script = buildRuntimeScript(this.scrollX, this.scrollY);
    // Se registra antes de cambiar srcdoc para no perder el evento.
    this.loaded = new Promise((resolve) => this.iframe.addEventListener('load', () => resolve(), { once: true }));
    this.iframe.srcdoc = injectRuntime(html, script);
  }

  /** Posición de scroll actual del visor (la última que informó el runtime). */
  get scroll(): { x: number; y: number } {
    return { x: this.scrollX, y: this.scrollY };
  }

  /** Fija la posición de scroll que se restaurará en el próximo render (al cambiar de documento). */
  set scroll(position: { x: number; y: number }) {
    this.scrollX = position.x;
    this.scrollY = position.y;
  }

  /** HTML (sin anotar) del último render; sirve para saber si el visor está al día. */
  get renderedHtml(): string {
    return this.lastHtml;
  }

  /**
   * Abre el diálogo de impresión del navegador con SOLO el contenido del visor.
   * Desde ahí el usuario elige "Guardar como PDF".
   *
   * La app no puede llamar a print() del iframe directamente (tiene otro origen),
   * así que se lo pide al runtime por postMessage. Si hay un render en curso,
   * se espera a que termine de cargar para no imprimir una página a medias.
   */
  async print(): Promise<void> {
    await this.loaded;
    this.iframe.contentWindow?.postMessage({ source: APP_MESSAGE_SOURCE, type: 'print' }, '*');
  }

  /** Activa o desactiva "Localizar en el código". Vuelve a renderizar para aplicar el cambio. */
  setLocateEnabled(enabled: boolean): void {
    if (this.locateEnabled === enabled) return;
    this.locateEnabled = enabled;
    // Antes del primer render no hay nada que actualizar.
    if (this.hasRendered) this.reload();
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
      case 'selection': {
        if (!this.locateEnabled) return;
        const range =
          this.snapshot && data.start && data.end ? locateSelection(this.snapshot, data.start, data.end) : null;
        this.callbacks.onSourceSelection(range, this.snapshot?.source ?? this.lastHtml);
        break;
      }
    }
  };
}

/** Escapa un texto para usarlo dentro de un atributo HTML entre comillas dobles. */
function escapeAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
