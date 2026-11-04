/**
 * main.ts — Punto de entrada: crea cada pieza de la app y las conecta.
 *
 * Este archivo NO contiene lógica de detalle; solo "cablea" los módulos.
 * Está ordenado en secciones que se leen de arriba hacia abajo:
 *
 *   1. Estado, preferencias y documentos
 *   2. Tema
 *   3. Barra de estado, consola y visor
 *   4. Editor
 *   5. Actualización del visor (automática y manual)
 *   6. Documentos: pestañas, abrir, guardar y cerrar
 *   7. Autoguardado y aviso al salir
 *   8. Divisor, dispositivos y pestañas móviles
 *   9. Acciones de la barra superior
 *  10. Atajos de teclado
 *  11. Arranque
 *
 * Mapa de módulos:
 *   config.ts            valores ajustables (tiempos, límites, dispositivos)
 *   storage.ts           acceso seguro a localStorage
 *   settings.ts          preferencias persistentes
 *   documents.ts         documentos abiertos (datos y autoguardado)
 *   file-system.ts       abrir y guardar directamente en el disco
 *   file-io.ts           validar archivos, descargar copias, portapapeles, arrastrar/soltar
 *   editor/editor.ts     CodeMirror 6
 *   editor/formatter.ts  Prettier (carga diferida)
 *   preview/preview.ts   iframe sandbox + mensajes
 *   preview/runtime.ts   script inyectado en el iframe
 *   preview/console-panel.ts, preview/devices.ts
 *   ui/*                 divisor, diálogos, avisos, tema, barra de estado, pestañas
 *   shortcuts.ts         atajos globales
 */

import './styles/index.css';

import { CONFIG } from './config';
import { createDocument, loadDocuments, saveDocuments, uniqueName, type OpenDocument } from './documents';
import { createEditor } from './editor/editor';
import { describeFormatError, formatHtml } from './editor/formatter';
import { copyToClipboard, downloadHtml, FileValidationError, normalizeFilename, readTextFile, setupDropZone } from './file-io';
import {
  describeWriteError,
  filesFromDrop,
  forgetHandlesExcept,
  FS_SUPPORTED,
  loadHandles,
  pickFilesToOpen,
  pickSaveTarget,
  rememberHandle,
  writeFile,
  type DiskFileHandle,
  type OpenedFile,
} from './file-system';
import { ConsolePanel } from './preview/console-panel';
import { DeviceController } from './preview/devices';
import { Preview } from './preview/preview';
import { SAMPLE_HTML } from './sample';
import { loadSettings, saveSettings, type Settings } from './settings';
import { registerShortcuts } from './shortcuts';
import { confirmDialog, openDialog, setupDialogs } from './ui/dialogs';
import { DocTabs } from './ui/doc-tabs';
import { Splitter } from './ui/splitter';
import { StatusBar } from './ui/statusbar';
import { ThemeController } from './ui/theme';
import { showToast } from './ui/toast';
import { byId, clamp, debounce, IS_MAC } from './utils';

// =============================================================================
// 1. Estado, preferencias y documentos
// =============================================================================

const settings: Settings = loadSettings();

/** Guarda una o varias preferencias. Un fallo no es grave: solo no se recordarán. */
function updateSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  saveSettings(settings);
}

/**
 * Estado de la sesión que NO se persiste.
 *   autosaveFailed  el último intento de autoguardado falló.
 */
const session = {
  autosaveFailed: false,
};

/**
 * Documentos abiertos, en el orden de las pestañas. Siempre hay al menos uno.
 * El contenido del documento activo se mantiene al día en cada tecla
 * (ver handleDocumentChange), así `doc.content` siempre es el texto actual.
 */
const restored = loadDocuments();
const docs: OpenDocument[] = restored?.docs ?? [createDocument(CONFIG.defaultExportName, SAMPLE_HTML)];
let activeId = restored?.activeId ?? docs[0].id;

function activeDoc(): OpenDocument {
  return docs.find((doc) => doc.id === activeId) ?? docs[0];
}

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
  onBeforeRender: () => {
    consolePanel.clear();
    staleNoticeShown = false;
  },
  onConsole: (level, text) => consolePanel.add(level, text),
  onKey: (key) => {
    if (key === 'Escape') setFullscreen(false);
  },
  onSourceSelection: (range, renderedSource) => handleSourceSelection(range, renderedSource),
});

// =============================================================================
// 4. Editor
// =============================================================================

const editor = createEditor({
  parent: byId('editor'),
  initialId: activeId,
  initialDoc: activeDoc().content,
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

/** Se ejecuta en cada cambio del texto del editor (no al cambiar de pestaña). */
function handleDocumentChange(text: string): void {
  const doc = activeDoc();
  doc.content = text;
  if (!doc.dirty) {
    doc.dirty = true;
    refreshTabs();
  }
  statusBar.setSaveState('pending');
  autosave();
  if (settings.autoUpdate) scheduleRender();
}

// =============================================================================
// 5. Actualización del visor
// =============================================================================

const scheduleRender = debounce(() => preview.render(editor.getValue()), CONFIG.previewDebounceMs);

/** Actualiza el visor ya mismo (botón Previsualizar, Ctrl/Cmd+Enter, cambio de pestaña). */
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

// --- Localizar en el código --------------------------------------------------
// Al seleccionar texto en el visor, se resalta en el editor el código que lo genera.

const locateButton = byId('btn-locate');
/** Evita repetir el aviso de "código desactualizado" en cada selección. */
let staleNoticeShown = false;

function setLocateSource(enabled: boolean): void {
  updateSettings({ locateSource: enabled });
  locateButton.setAttribute('aria-pressed', String(enabled));
  preview.setLocateEnabled(enabled);
  if (!enabled) editor.clearHighlight();
}

function handleSourceSelection(range: { from: number; to: number } | null, renderedSource: string): void {
  if (!range) {
    editor.clearHighlight();
    return;
  }
  // Las posiciones son las del código que se renderizó. Si después se editó
  // (con Auto apagado), ya no apuntan al lugar correcto.
  if (renderedSource !== editor.getValue()) {
    if (!staleNoticeShown) {
      showToast('El código cambió desde la última vista previa. Pulsá Previsualizar para poder localizarlo.');
      staleNoticeShown = true;
    }
    return;
  }
  editor.highlightRange(range.from, range.to);
}

locateButton.addEventListener('click', () => setLocateSource(!settings.locateSource));
setLocateSource(settings.locateSource);

// =============================================================================
// 6. Documentos: pestañas, abrir, guardar y cerrar
// =============================================================================

const docTabs = new DocTabs(byId('doc-tabs'), {
  onSelect: (id) => switchTo(id),
  onClose: (id) => void closeDocument(id),
  onNew: () => addDocument(createDocument(uniqueName(docs), '')),
});

/** Redibuja las pestañas y actualiza el título de la ventana. */
function refreshTabs(): void {
  docTabs.render(docs, activeId);
  const doc = activeDoc();
  document.title = `${doc.dirty ? '● ' : ''}${doc.name} · Editor HTML Visor`;
}

/** Muestra otro documento en el editor y en el visor. */
function switchTo(id: string): void {
  if (id === activeId || !docs.some((doc) => doc.id === id)) return;
  activeDoc().previewScroll = preview.scroll;
  activeId = id;
  const doc = activeDoc();
  editor.showDocument(doc.id, doc.content);
  preview.scroll = doc.previewScroll;
  renderNow();
  refreshTabs();
  autosave(); // recordar cuál quedó activo
}

/** Agrega un documento y lo muestra. Devuelve `false` si ya hay demasiados abiertos. */
function addDocument(doc: OpenDocument): boolean {
  if (docs.length >= CONFIG.maxOpenDocuments) {
    showToast(`Ya hay ${CONFIG.maxOpenDocuments} documentos abiertos. Cerrá alguno para abrir otro.`, 'error', 6000);
    return false;
  }
  docs.push(doc);
  switchTo(doc.id);
  return true;
}

/** Quita un documento sin preguntar. Si era el último, deja uno vacío. */
function removeDocument(id: string): void {
  const index = docs.findIndex((doc) => doc.id === id);
  if (index === -1) return;
  if (docs.length === 1) docs.push(createDocument(uniqueName(docs), ''));
  // Si se cierra el activo, pasar antes a la pestaña vecina.
  if (id === activeId) switchTo((docs[index + 1] ?? docs[index - 1]).id);
  docs.splice(index, 1);
  editor.forgetDocument(id);
  rememberHandle(id, null);
  refreshTabs();
  autosave();
}

/** Cierra una pestaña. Si tiene cambios sin guardar, pide confirmación. */
async function closeDocument(id: string): Promise<void> {
  const doc = docs.find((d) => d.id === id);
  if (!doc) return;
  if (doc.dirty) {
    const ok = await confirmDialog({
      title: 'Cerrar sin guardar',
      message: doc.handle
        ? `"${doc.name}" tiene cambios que no se guardaron en el archivo. Si cerrás la pestaña, se pierden.`
        : `"${doc.name}" no está guardado en ningún archivo. Si cerrás la pestaña, se pierde su contenido.`,
      confirmLabel: 'Cerrar sin guardar',
      danger: true,
    });
    if (!ok) return;
  }
  removeDocument(id);
}

/** Un documento que se puede reemplazar sin preguntar: nuevo, sin cambios y vacío o con el ejemplo. */
function isDisposable(doc: OpenDocument): boolean {
  return !doc.handle && !doc.dirty && (doc.content.trim() === '' || doc.content === SAMPLE_HTML);
}

/** Busca un documento abierto que corresponda al mismo archivo del disco. */
async function findOpenFile(handle: DiskFileHandle): Promise<OpenDocument | null> {
  for (const doc of docs) {
    if (doc.handle && (await doc.handle.isSameEntry(handle).catch(() => false))) return doc;
  }
  return null;
}

/**
 * Abre archivos, cada uno en su pestaña.
 *   - Si un archivo ya estaba abierto, se pasa a su pestaña en lugar de duplicarlo.
 *   - Si la pestaña actual es descartable (ver isDisposable), el primer archivo la reemplaza.
 */
async function openFiles(entries: OpenedFile[]): Promise<void> {
  const replaceable = isDisposable(activeDoc()) ? activeId : null;
  const opened: string[] = [];

  for (const { file, handle } of entries) {
    try {
      const existing = handle ? await findOpenFile(handle) : null;
      if (existing) {
        switchTo(existing.id);
        continue;
      }
      const text = await readTextFile(file);
      // Sin handle no se guardará sobre el original: se ofrece como .html.
      const name = handle ? file.name : normalizeFilename(file.name.replace(/\.txt$/i, '.html'));
      const doc = createDocument(name, text, handle);
      if (!addDocument(doc)) break;
      rememberHandle(doc.id, handle);
      opened.push(name);
    } catch (error) {
      const message = error instanceof FileValidationError ? error.message : `No se pudo leer "${file.name}".`;
      showToast(message, 'error', 6000);
    }
  }

  if (replaceable && opened.length > 0) removeDocument(replaceable);
  if (opened.length === 1) showToast(`Abierto: ${opened[0]}`, 'success');
  else if (opened.length > 1) showToast(`Se abrieron ${opened.length} archivos`, 'success');
}

/** Abrir: el selector del sistema (Chrome/Edge) o el <input type="file"> clásico. */
const fileInput = byId<HTMLInputElement>('file-input');

async function openFromDisk(): Promise<void> {
  if (!FS_SUPPORTED) {
    fileInput.click();
    return;
  }
  try {
    await openFiles(await pickFilesToOpen());
  } catch (error) {
    showToast(`No se pudo abrir: ${describeWriteError(error)}`, 'error', 6000);
  }
}

fileInput.addEventListener('change', () => {
  const entries = [...(fileInput.files ?? [])].map((file) => ({ file, handle: null }));
  fileInput.value = ''; // permite volver a elegir el mismo archivo
  void openFiles(entries);
});
setupDropZone(byId('editor-pane'), (data) => void filesFromDrop(data).then(openFiles));

/** Escribe el documento en `handle`. Devuelve `true` si se guardó. */
async function writeDocument(doc: OpenDocument, handle: DiskFileHandle): Promise<boolean> {
  const text = doc.content;
  try {
    await writeFile(handle, text);
  } catch (error) {
    showToast(`No se pudo guardar "${handle.name}": ${describeWriteError(error)}.`, 'error', 7000);
    return false;
  }
  // Si se siguió escribiendo mientras se guardaba, quedan cambios pendientes.
  doc.dirty = doc.content !== text;
  refreshTabs();
  autosave();
  showToast(`Guardado: ${handle.name}`, 'success');
  return true;
}

/**
 * Guardar como: elegir dónde guardar. A partir de ahí, el documento queda
 * vinculado a ese archivo. Sin la API del sistema de archivos, descarga una copia.
 */
async function saveAs(doc = activeDoc()): Promise<void> {
  if (!FS_SUPPORTED) {
    openExportDialog();
    return;
  }
  let handle: DiskFileHandle | null;
  try {
    handle = await pickSaveTarget(doc.name);
  } catch (error) {
    showToast(`No se pudo guardar: ${describeWriteError(error)}`, 'error', 7000);
    return;
  }
  if (!handle || !(await writeDocument(doc, handle))) return;
  doc.handle = handle;
  doc.name = handle.name;
  rememberHandle(doc.id, handle);
  refreshTabs();
  autosave();
}

/** Guardar: escribe en el archivo vinculado; si no tiene, funciona como "Guardar como". */
async function save(doc = activeDoc()): Promise<void> {
  if (doc.handle) await writeDocument(doc, doc.handle);
  else await saveAs(doc);
}

// =============================================================================
// 7. Autoguardado y aviso al salir
// =============================================================================

// Copia de seguridad en el navegador de TODOS los documentos abiertos
// (no reemplaza a "Guardar", que escribe en el archivo del disco).
const autosave = debounce(() => {
  const ok = saveDocuments(docs, activeId);
  session.autosaveFailed = !ok;
  statusBar.setSaveState(ok ? 'saved' : 'failed');
}, CONFIG.autosaveDebounceMs);

window.addEventListener('beforeunload', (event) => {
  // Si quedaba un autoguardado pendiente, intentarlo ahora.
  if (autosave.pending) autosave.flush();
  // Solo advertir si el autoguardado falló Y hay cambios sin guardar:
  // en cualquier otro caso, el trabajo está a salvo en el navegador.
  if (session.autosaveFailed && docs.some((doc) => doc.dirty)) {
    event.preventDefault();
    event.returnValue = ''; // necesario en algunos navegadores para mostrar el aviso
  }
});

// =============================================================================
// 8. Divisor, dispositivos y pestañas móviles
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
// 9. Acciones de la barra superior
// =============================================================================

/** Asocia un botón (por id) con una acción. */
function onClick(id: string, action: () => void): void {
  byId(id).addEventListener('click', action);
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

// --- Archivo: abrir, guardar, ejemplo, limpiar ---------------------------------
onClick('btn-open', () => void openFromDisk());
onClick('btn-save', () => void save());
onClick('btn-save-as', () => void saveAs());

// El ejemplo se abre en una pestaña nueva, así no reemplaza nada.
onClick('btn-sample', () => addDocument(createDocument(uniqueName(docs, 'ejemplo'), SAMPLE_HTML)));

/** Atajo de deshacer según el sistema, para mencionarlo en los mensajes. */
const UNDO_KEY = IS_MAC ? '⌘Z' : 'Ctrl+Z';

onClick('btn-clear', async () => {
  if (!editor.getValue().trim()) return;
  const ok = await confirmDialog({
    title: 'Limpiar el editor',
    message: `Se borrará todo el contenido de "${activeDoc().name}". Podés deshacerlo con ${UNDO_KEY}.`,
    confirmLabel: 'Limpiar',
    danger: true,
  });
  if (!ok) return;
  editor.setValue('');
  renderNow();
});

// --- Exportar (descargar copia, copiar, PDF) ------------------------------------
const exportDialog = byId<HTMLDialogElement>('export-dialog');
const exportName = byId<HTMLInputElement>('export-name');

function openExportDialog(): void {
  exportName.value = activeDoc().name;
  exportDialog.showModal();
  // Seleccionar solo el nombre, sin la extensión, para escribir encima directamente.
  exportName.setSelectionRange(0, exportName.value.replace(/\.(html?|txt)$/i, '').length);
}

// El <form method="dialog"> se envía con Enter o con el botón Descargar.
byId('export-form').addEventListener('submit', () => {
  const doc = activeDoc();
  const filename = normalizeFilename(exportName.value);
  downloadHtml(doc.content, filename);
  // Un documento sin archivo vinculado queda "guardado" con la descarga.
  // Uno vinculado sigue teniendo cambios pendientes en SU archivo.
  if (!doc.handle) {
    doc.name = filename;
    doc.dirty = false;
    refreshTabs();
    autosave();
  }
  showToast(`Descargado: ${filename}`, 'success');
});

onClick('export-copy', async () => {
  const ok = await copyToClipboard(editor.getValue());
  exportDialog.close();
  showToast(ok ? 'Código copiado al portapapeles' : 'El navegador no permitió copiar al portapapeles.', ok ? 'success' : 'error');
});
onClick('btn-export', openExportDialog);

/**
 * Exportar → PDF: abre el diálogo de impresión del navegador con SOLO el
 * documento del visor (sin el código ni la interfaz). Ahí se elige
 * "Guardar como PDF". No genera el PDF la app: lo hace el navegador, así que
 * el resultado respeta los estilos `@media print` del usuario.
 */
async function exportPdf(): Promise<void> {
  exportDialog.close();
  // Si el visor quedó desactualizado (Auto apagado o un render pendiente),
  // actualizarlo antes para que el PDF coincida con el código.
  if (preview.renderedHtml !== editor.getValue()) renderNow();
  showPane('preview'); // en móvil, el visor debe estar visible
  await preview.print();
}
onClick('export-pdf', () => void exportPdf());

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
// 10. Atajos de teclado
// =============================================================================

registerShortcuts({
  open: () => void openFromDisk(),
  save: () => void save(),
  saveAs: () => void saveAs(),
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
// 11. Arranque
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

// Sin la API del sistema de archivos, "Guardar" descarga una copia: avisarlo en el tooltip.
if (!FS_SUPPORTED) {
  byId('btn-save').title = 'Este navegador no permite escribir en archivos: descarga una copia (Ctrl+S)';
  byId('btn-save-as').hidden = true;
}

// Recuperar los archivos vinculados de la sesión anterior (IndexedDB es asíncrono).
void loadHandles(docs.map((doc) => doc.id)).then((handles) => {
  for (const doc of docs) doc.handle = handles.get(doc.id) ?? doc.handle;
  refreshTabs();
  forgetHandlesExcept(docs.map((doc) => doc.id));
});

refreshTabs();
statusBar.setSaveState('saved');
renderNow(); // primer render, aunque la actualización automática esté apagada
