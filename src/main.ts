/**
 * main.ts — Punto de entrada: crea cada pieza de la app y las conecta.
 *
 * Este archivo NO contiene lógica de detalle; solo "cablea" los módulos.
 * Está ordenado en secciones que se leen de arriba hacia abajo:
 *
 *   1. Estado y preferencias
 *   2. Tema
 *   3. Barra de estado, consola y visor
 *   4. Editor
 *   5. Actualización del visor (automática y manual)
 *   6. Autoguardado y aviso al salir
 *   7. Divisor, dispositivos y pestañas móviles
 *   8. Acciones de la barra superior
 *   9. Atajos de teclado
 *  10. Arranque
 *
 * Mapa de módulos:
 *   config.ts            valores ajustables (tiempos, límites, dispositivos)
 *   storage.ts           acceso seguro a localStorage
 *   settings.ts          preferencias persistentes
 *   editor/editor.ts     CodeMirror 6
 *   editor/formatter.ts  Prettier (carga diferida)
 *   preview/preview.ts   iframe sandbox + mensajes
 *   preview/runtime.ts   script inyectado en el iframe
 *   preview/console-panel.ts, preview/devices.ts
 *   ui/*                 divisor, diálogos, avisos, tema, barra de estado
 *   file-io.ts           importar / exportar / portapapeles
 *   shortcuts.ts         atajos globales
 */

import './styles/index.css';

import { CONFIG, STORAGE_KEYS } from './config';
import { createEditor } from './editor/editor';
import { describeFormatError, formatHtml } from './editor/formatter';
import {
  copyToClipboard,
  downloadHtml,
  FileValidationError,
  normalizeFilename,
  readTextFile,
  setupDropZone,
} from './file-io';
import { ConsolePanel } from './preview/console-panel';
import { DeviceController } from './preview/devices';
import { Preview } from './preview/preview';
import { SAMPLE_HTML } from './sample';
import { loadSettings, saveSettings, type Settings } from './settings';
import { registerShortcuts } from './shortcuts';
import { readText, writeText } from './storage';
import { confirmDialog, openDialog, setupDialogs } from './ui/dialogs';
import { Splitter } from './ui/splitter';
import { StatusBar } from './ui/statusbar';
import { ThemeController } from './ui/theme';
import { showToast } from './ui/toast';
import { byId, clamp, debounce, IS_MAC } from './utils';

// =============================================================================
// 1. Estado y preferencias
// =============================================================================

const settings: Settings = loadSettings();

/** Guarda una o varias preferencias. Un fallo no es grave: solo no se recordarán. */
function updateSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  saveSettings(settings);
}

/**
 * Estado de la sesión que NO se persiste.
 *   autosaveFailed      el último intento de autoguardado falló.
 *   changedSinceExport  hubo cambios desde la última exportación (o desde que se abrió).
 *   exportName          último nombre de archivo usado al exportar.
 */
const session = {
  autosaveFailed: false,
  changedSinceExport: false,
  exportName: CONFIG.defaultExportName as string,
};

// =============================================================================
// 2. Tema
// =============================================================================

// El editor todavía no existe; ThemeController aplica el tema al instante y
// el editor lo recibe al crearse (sección 4).
let applyEditorTheme: (theme: 'light' | 'dark') => void = () => {};
const theme = new ThemeController(
  settings.theme,
  (current) => applyEditorTheme(current),
  (chosen) => updateSettings({ theme: chosen }),
);

// =============================================================================
// 3. Barra de estado, consola y visor
// =============================================================================

const statusBar = new StatusBar(() => {
  consolePanel.setOpen(true);
  showPane('preview'); // en móvil, la consola está en la pestaña del visor
});

const consolePanel = new ConsolePanel(
  settings.consoleOpen,
  (counts) => statusBar.setConsoleCounts(counts),
  (open) => updateSettings({ consoleOpen: open }),
);

const preview = new Preview(byId<HTMLIFrameElement>('preview-frame'), {
  onBeforeRender: () => consolePanel.clear(),
  onConsole: (level, text) => consolePanel.add(level, text),
  onKey: (key) => {
    if (key === 'Escape') setFullscreen(false);
  },
});

// =============================================================================
// 4. Editor
// =============================================================================

const editor = createEditor({
  parent: byId('editor'),
  initialDoc: readText(STORAGE_KEYS.content) ?? SAMPLE_HTML,
  theme: theme.current,
  fontSize: settings.fontSize,
  wordWrap: settings.wordWrap,
  onChange: handleDocumentChange,
  onCursor: (line, column, length) => {
    statusBar.setCursor(line, column);
    statusBar.setLength(length);
  },
});
applyEditorTheme = (current) => editor.setTheme(current);

/** Se ejecuta en cada cambio del texto del editor. */
function handleDocumentChange(): void {
  session.changedSinceExport = true;
  statusBar.setSaveState('pending');
  autosave();
  if (settings.autoUpdate) scheduleRender();
}

// =============================================================================
// 5. Actualización del visor
// =============================================================================

const scheduleRender = debounce(() => preview.render(editor.getValue()), CONFIG.previewDebounceMs);

/** Actualiza el visor ya mismo (botón Previsualizar, Ctrl/Cmd+Enter). */
function renderNow(): void {
  scheduleRender.cancel();
  preview.render(editor.getValue());
}

const autoToggle = byId<HTMLInputElement>('toggle-auto');
autoToggle.checked = settings.autoUpdate;
autoToggle.addEventListener('change', () => {
  updateSettings({ autoUpdate: autoToggle.checked });
  // Al reactivarlo, mostrar el estado actual del código.
  if (autoToggle.checked) renderNow();
  else scheduleRender.cancel();
});

// =============================================================================
// 6. Autoguardado y aviso al salir
// =============================================================================

const autosave = debounce(() => {
  const ok = writeText(STORAGE_KEYS.content, editor.getValue());
  session.autosaveFailed = !ok;
  statusBar.setSaveState(ok ? 'saved' : 'failed');
}, CONFIG.autosaveDebounceMs);

window.addEventListener('beforeunload', (event) => {
  // Si quedaba un autoguardado pendiente, intentarlo ahora.
  if (autosave.pending) autosave.flush();
  // Solo advertir si el autoguardado falló Y hay cambios que no se exportaron:
  // en cualquier otro caso, el trabajo no se pierde.
  if (session.autosaveFailed && session.changedSinceExport) {
    event.preventDefault();
    event.returnValue = ''; // necesario en algunos navegadores para mostrar el aviso
  }
});

// =============================================================================
// 7. Divisor, dispositivos y pestañas móviles
// =============================================================================

const workspace = byId('workspace');

new Splitter(workspace, byId('splitter'), settings.splitRatio, (ratio) => updateSettings({ splitRatio: ratio }));

new DeviceController(
  {
    device: settings.device,
    customWidth: settings.customWidth,
    customHeight: settings.customHeight,
    landscape: settings.landscape,
  },
  (state) => updateSettings(state),
);

const tabCode = byId<HTMLButtonElement>('tab-code');
const tabPreview = byId<HTMLButtonElement>('tab-preview');

/** En pantallas angostas, muestra uno de los dos paneles. En escritorio no tiene efecto visible. */
function showPane(pane: 'code' | 'preview'): void {
  workspace.dataset.mobileTab = pane;
  tabCode.setAttribute('aria-selected', String(pane === 'code'));
  tabPreview.setAttribute('aria-selected', String(pane === 'preview'));
}
tabCode.addEventListener('click', () => showPane('code'));
tabPreview.addEventListener('click', () => showPane('preview'));

// =============================================================================
// 8. Acciones de la barra superior
// =============================================================================

/** Asocia un botón (por id) con una acción. */
function onClick(id: string, action: () => void): void {
  byId(id).addEventListener('click', action);
}

/** Reemplaza el contenido del editor y actualiza el visor de inmediato. */
function replaceContent(text: string): void {
  editor.setValue(text);
  renderNow();
}

/** `true` si el editor tiene algo más que espacios en blanco. */
function hasContent(): boolean {
  return editor.getValue().trim().length > 0;
}

// --- Previsualizar -----------------------------------------------------------
onClick('btn-preview', () => {
  renderNow();
  showPane('preview');
});
onClick('btn-reload', () => preview.reload());
onClick('btn-open-tab', () => {
  if (!preview.openInNewTab(editor.getValue())) {
    showToast('El navegador bloqueó la pestaña nueva. Permití las ventanas emergentes para este sitio.', 'error');
  }
});

// --- Formatear ---------------------------------------------------------------
async function formatDocument(): Promise<void> {
  const button = byId<HTMLButtonElement>('btn-format');
  button.disabled = true;
  try {
    const original = editor.getValue();
    const formatted = await formatHtml(original);
    if (formatted !== original) editor.setValue(formatted);
    showToast('Código formateado', 'success');
  } catch (error) {
    // El contenido del editor no se modificó: solo informamos el problema.
    showToast(`No se pudo formatear: ${describeFormatError(error)}`, 'error', 7000);
  } finally {
    button.disabled = false;
  }
}
onClick('btn-format', () => void formatDocument());

// --- Plegar / Desplegar / Buscar ---------------------------------------------
onClick('btn-fold', () => editor.foldAll());
onClick('btn-unfold', () => editor.unfoldAll());
onClick('btn-search', () => {
  showPane('code');
  editor.openSearch();
});

// --- Ajuste de línea ---------------------------------------------------------
const wrapButton = byId('btn-wrap');
wrapButton.setAttribute('aria-pressed', String(settings.wordWrap));
onClick('btn-wrap', () => {
  const enabled = !settings.wordWrap;
  updateSettings({ wordWrap: enabled });
  editor.setWordWrap(enabled);
  wrapButton.setAttribute('aria-pressed', String(enabled));
});

// --- Tamaño de fuente --------------------------------------------------------
const fontLabel = byId('font-size-label');
function changeFontSize(delta: number): void {
  const size = clamp(settings.fontSize + delta, CONFIG.fontSize.min, CONFIG.fontSize.max);
  updateSettings({ fontSize: size });
  editor.setFontSize(size);
  fontLabel.textContent = String(size);
}
fontLabel.textContent = String(settings.fontSize);
onClick('btn-font-dec', () => changeFontSize(-CONFIG.fontSize.step));
onClick('btn-font-inc', () => changeFontSize(CONFIG.fontSize.step));

// --- Muestra / Limpiar -------------------------------------------------------
/** Atajo de deshacer según el sistema, para mencionarlo en los mensajes. */
const UNDO_KEY = IS_MAC ? '⌘Z' : 'Ctrl+Z';

onClick('btn-sample', async () => {
  if (hasContent()) {
    const ok = await confirmDialog({
      title: 'Cargar ejemplo',
      message: `El contenido actual del editor se reemplazará por el ejemplo. Podés deshacerlo con ${UNDO_KEY}.`,
      confirmLabel: 'Reemplazar',
    });
    if (!ok) return;
  }
  replaceContent(SAMPLE_HTML);
});

onClick('btn-clear', async () => {
  if (!hasContent()) return;
  const ok = await confirmDialog({
    title: 'Limpiar el editor',
    message: `Se borrará todo el contenido del editor. Podés deshacerlo con ${UNDO_KEY}.`,
    confirmLabel: 'Limpiar',
    danger: true,
  });
  if (ok) replaceContent('');
});

// --- Importar (botón y arrastrar/soltar) -------------------------------------
const fileInput = byId<HTMLInputElement>('file-input');

async function importFile(file: File): Promise<void> {
  try {
    const text = await readTextFile(file);
    replaceContent(text);
    session.exportName = normalizeFilename(file.name.replace(/\.txt$/i, '.html'));
    showToast(`Importado: ${file.name}`, 'success');
  } catch (error) {
    const message = error instanceof FileValidationError ? error.message : `No se pudo leer "${file.name}".`;
    showToast(message, 'error', 6000);
  }
}

onClick('btn-import', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void importFile(file);
  fileInput.value = ''; // permite volver a elegir el mismo archivo
});
setupDropZone(byId('editor-pane'), (file) => void importFile(file));

// --- Exportar ------------------------------------------------------------------
const exportDialog = byId<HTMLDialogElement>('export-dialog');
const exportName = byId<HTMLInputElement>('export-name');

function openExportDialog(): void {
  exportName.value = session.exportName;
  exportDialog.showModal();
  // Seleccionar solo el nombre, sin la extensión, para escribir encima directamente.
  exportName.setSelectionRange(0, exportName.value.replace(/\.html?$/i, '').length);
}

// El <form method="dialog"> se envía con Enter o con el botón Descargar.
byId('export-form').addEventListener('submit', () => {
  const filename = normalizeFilename(exportName.value);
  session.exportName = filename;
  downloadHtml(editor.getValue(), filename);
  session.changedSinceExport = false;
  showToast(`Descargado: ${filename}`, 'success');
});

onClick('export-copy', async () => {
  const ok = await copyToClipboard(editor.getValue());
  exportDialog.close();
  showToast(ok ? 'Código copiado al portapapeles' : 'El navegador no permitió copiar al portapapeles.', ok ? 'success' : 'error');
});
onClick('btn-export', openExportDialog);

// --- Pantalla completa del visor ---------------------------------------------
const app = byId('app');

function setFullscreen(enabled: boolean): void {
  app.classList.toggle('is-preview-fullscreen', enabled);
  byId('btn-fullscreen').setAttribute('aria-pressed', String(enabled));
  // Devolver el foco a un lugar lógico para que el teclado no quede "perdido".
  if (enabled) byId('btn-exit-fullscreen').focus();
}
const isFullscreen = () => app.classList.contains('is-preview-fullscreen');

onClick('btn-fullscreen', () => setFullscreen(!isFullscreen()));
onClick('btn-exit-fullscreen', () => setFullscreen(false));

// --- Tema y ayuda ------------------------------------------------------------
onClick('btn-theme', () => theme.toggle());
onClick('btn-help', () => openDialog('help-dialog'));

// =============================================================================
// 9. Atajos de teclado
// =============================================================================

registerShortcuts({
  exportFile: openExportDialog,
  refreshPreview: renderNow,
  format: () => void formatDocument(),
  search: () => {
    showPane('code');
    editor.openSearch();
  },
  escape: () => {
    if (!isFullscreen()) return false;
    setFullscreen(false);
    return true;
  },
});

// =============================================================================
// 10. Arranque
// =============================================================================

setupDialogs();

// En macOS, mostrar ⌘ y ⌥ en lugar de Ctrl y Alt en la ayuda y en los tooltips.
if (IS_MAC) {
  for (const kbd of document.querySelectorAll('kbd[data-mod]')) kbd.textContent = '⌘';
  for (const kbd of document.querySelectorAll('kbd[data-alt]')) kbd.textContent = '⌥';
  for (const el of document.querySelectorAll<HTMLElement>('[title]')) {
    el.title = el.title.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥');
  }
}

statusBar.setSaveState('saved');
renderNow(); // primer render, aunque la actualización automática esté apagada
