/**
 * editor.ts — Creación y control del editor CodeMirror 6.
 *
 * Expone una API pequeña (`HtmlEditor`) para que el resto de la app no tenga
 * que conocer los detalles de CodeMirror.
 *
 * Qué aporta cada pieza:
 *   - `basicSetup` (paquete `codemirror`): números de línea, plegado, historial
 *     (deshacer/rehacer), múltiples cursores, cierre de corchetes, autocompletado,
 *     búsqueda/reemplazo (Ctrl/Cmd+F), resaltado del par de corchetes/etiquetas
 *     y comentar/descomentar (Ctrl/Cmd+/).
 *   - `html()` (`@codemirror/lang-html`): resaltado de HTML con CSS y JS embebidos,
 *     autocompletado de etiquetas/atributos y cierre automático de etiquetas.
 *
 * "Localizar en el código" usa un resaltado propio (`highlightField`): una
 * decoración que marca un rango sin mover el cursor ni quitarle el foco al visor.
 *
 * Varios documentos (pestañas): CodeMirror guarda todo lo de un documento
 * (texto, historial de deshacer, cursor, plegados) en un `EditorState`. Hay un
 * solo editor en pantalla; al cambiar de pestaña se guarda el estado actual y
 * se muestra el del otro documento con `view.setState`. Así cada pestaña
 * conserva su propio historial.
 *
 * Las opciones que cambian en tiempo de ejecución (tema, tamaño de fuente,
 * ajuste de línea) viven en "compartimentos" (`Compartment`), que permiten
 * reconfigurarlas sin recrear el editor.
 */

import { basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { Compartment, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { foldAll, unfoldAll } from '@codemirror/language';
import { openSearchPanel } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import type { ThemeName } from '../settings';

export interface EditorOptions {
  parent: HTMLElement;
  /** Id del documento que se muestra al empezar (ver documents.ts). */
  initialId: string;
  initialDoc: string;
  theme: ThemeName;
  fontSize: number;
  wordWrap: boolean;
  /** Se llama cada vez que el usuario cambia el texto (no al mover el cursor ni al cambiar de documento). */
  onChange: (doc: string) => void;
  /** Se llama cuando se mueve el cursor o cambia el texto. Línea y columna empiezan en 1. */
  onCursor: (line: number, column: number, length: number) => void;
}

export interface HtmlEditor {
  readonly view: EditorView;
  getValue(): string;
  /**
   * Muestra otro documento. Si ya se mostró antes, recupera su historial,
   * cursor y scroll; si no, lo crea con `text`. No llama a `onChange`.
   */
  showDocument(id: string, text: string): void;
  /** Descarta el estado guardado de un documento (al cerrar su pestaña). */
  forgetDocument(id: string): void;
  /** Reemplaza todo el contenido. Queda en el historial, así que se puede deshacer. */
  setValue(text: string): void;
  setTheme(theme: ThemeName): void;
  setFontSize(px: number): void;
  setWordWrap(enabled: boolean): void;
  foldAll(): void;
  unfoldAll(): void;
  openSearch(): void;
  focus(): void;
  /** Resalta un rango (Localizar en el código) y desplaza el editor hasta él. */
  highlightRange(from: number, to: number): void;
  /** Quita el resaltado de "Localizar en el código". */
  clearHighlight(): void;
}

// --- Resaltado de "Localizar en el código" -----------------------------------

/** Efecto que fija (rango) o quita (`null`) el resaltado. */
const setHighlight = StateEffect.define<{ from: number; to: number } | null>();

/** Marca visual; el estilo de `.cm-source-highlight` está en styles/layout.css. */
const highlightMark = Decoration.mark({ class: 'cm-source-highlight' });

/**
 * Guarda el resaltado actual. Se borra al editar el documento: a partir de ese
 * momento el visor muestra otra versión y el resaltado ya no le corresponde.
 */
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(highlight, transaction) {
    if (transaction.docChanged) highlight = Decoration.none;
    for (const effect of transaction.effects) {
      if (effect.is(setHighlight)) {
        highlight = effect.value ? Decoration.set([highlightMark.range(effect.value.from, effect.value.to)]) : Decoration.none;
      }
    }
    return highlight;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Tema base: ocupa todo el alto del panel y usa la tipografía monoespaciada de la app. */
const layoutTheme = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-content': { paddingBlock: '8px' },
});

/**
 * Tema claro: CodeMirror ya trae colores claros por defecto; solo ajustamos los
 * fondos para que combinen con las variables CSS de la app.
 */
const lightTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--bg-editor)', color: 'var(--text)' },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-editor)',
      color: 'var(--text-muted)',
      borderRight: '1px solid var(--border)',
    },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--editor-active-line)' },
  },
  { dark: false },
);

function themeExtension(theme: ThemeName): Extension {
  return theme === 'dark' ? oneDark : lightTheme;
}

function fontSizeExtension(px: number): Extension {
  return EditorView.theme({ '&': { fontSize: `${px}px` } });
}

function wrapExtension(enabled: boolean): Extension {
  return enabled ? EditorView.lineWrapping : [];
}

export function createEditor(options: EditorOptions): HtmlEditor {
  const themeSlot = new Compartment();
  const fontSlot = new Compartment();
  const wrapSlot = new Compartment();

  /** Valores actuales de las opciones, para aplicarlos a todos los documentos. */
  const current = { theme: options.theme, fontSize: options.fontSize, wordWrap: options.wordWrap };

  /** Documentos que no se están mostrando: su estado y su posición de scroll. */
  const hidden = new Map<string, { state: EditorState; scrollTop: number }>();
  let currentId = options.initialId;

  /** Informa la posición del cursor y la longitud del documento. */
  const reportCursor = (state: EditorState) => {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    options.onCursor(line.number, head - line.from + 1, state.doc.length);
  };

  /** Crea el estado de un documento nuevo, con las opciones actuales. */
  const createState = (doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        basicSetup,
        html({ autoCloseTags: true, matchClosingTags: true }),
        // Tab indenta en lugar de mover el foco. Esc + Tab permite salir del editor
        // con el teclado (comportamiento estándar de CodeMirror para accesibilidad).
        keymap.of([indentWithTab]),
        layoutTheme,
        highlightField,
        themeSlot.of(themeExtension(current.theme)),
        fontSlot.of(fontSizeExtension(current.fontSize)),
        wrapSlot.of(wrapExtension(current.wordWrap)),
        EditorView.contentAttributes.of({ 'aria-label': 'Editor de código HTML' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(update.state.doc.toString());
          if (update.docChanged || update.selectionSet) reportCursor(update.state);
        }),
      ],
    });

  const view = new EditorView({ parent: options.parent, state: createState(options.initialDoc) });
  reportCursor(view.state);

  return {
    view,
    getValue: () => view.state.doc.toString(),
    showDocument(id, text) {
      if (id === currentId) return;
      hidden.set(currentId, { state: view.state, scrollTop: view.scrollDOM.scrollTop });
      const saved = hidden.get(id);
      hidden.delete(id);
      currentId = id;

      // setState no pasa por el updateListener, así que cambiar de pestaña no
      // cuenta como una modificación del documento.
      view.setState(saved?.state ?? createState(text));
      // Un estado guardado tiene las opciones de cuando se ocultó; actualizarlas.
      view.dispatch({
        effects: [
          themeSlot.reconfigure(themeExtension(current.theme)),
          fontSlot.reconfigure(fontSizeExtension(current.fontSize)),
          wrapSlot.reconfigure(wrapExtension(current.wordWrap)),
          setHighlight.of(null),
        ],
      });
      view.scrollDOM.scrollTop = saved?.scrollTop ?? 0;
      reportCursor(view.state);
    },
    forgetDocument(id) {
      hidden.delete(id);
    },
    setValue(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
    },
    setTheme(theme) {
      current.theme = theme;
      view.dispatch({ effects: themeSlot.reconfigure(themeExtension(theme)) });
    },
    setFontSize(px) {
      current.fontSize = px;
      view.dispatch({ effects: fontSlot.reconfigure(fontSizeExtension(px)) });
    },
    setWordWrap(enabled) {
      current.wordWrap = enabled;
      view.dispatch({ effects: wrapSlot.reconfigure(wrapExtension(enabled)) });
    },
    foldAll: () => foldAll(view),
    unfoldAll: () => unfoldAll(view),
    openSearch() {
      view.focus();
      openSearchPanel(view);
    },
    focus: () => view.focus(),
    highlightRange(from, to) {
      const length = view.state.doc.length;
      const start = Math.max(0, Math.min(from, length));
      const end = Math.max(start, Math.min(to, length));
      if (end === start) return; // un rango vacío no se vería
      view.dispatch({
        effects: [setHighlight.of({ from: start, to: end }), EditorView.scrollIntoView(start, { y: 'center' })],
      });
    },
    clearHighlight: () => view.dispatch({ effects: setHighlight.of(null) }),
  };
}
