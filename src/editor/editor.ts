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
 * Las opciones que cambian en tiempo de ejecución (tema, tamaño de fuente,
 * ajuste de línea) viven en "compartimentos" (`Compartment`), que permiten
 * reconfigurarlas sin recrear el editor.
 */

import { basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { foldAll, unfoldAll } from '@codemirror/language';
import { openSearchPanel } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import type { ThemeName } from '../settings';

export interface EditorOptions {
  parent: HTMLElement;
  initialDoc: string;
  theme: ThemeName;
  fontSize: number;
  wordWrap: boolean;
  /** Se llama cada vez que cambia el texto (no al mover el cursor). */
  onChange: (doc: string) => void;
  /** Se llama cuando se mueve el cursor o cambia el texto. Línea y columna empiezan en 1. */
  onCursor: (line: number, column: number, length: number) => void;
}

export interface HtmlEditor {
  readonly view: EditorView;
  getValue(): string;
  /** Reemplaza todo el contenido. Queda en el historial, así que se puede deshacer. */
  setValue(text: string): void;
  setTheme(theme: ThemeName): void;
  setFontSize(px: number): void;
  setWordWrap(enabled: boolean): void;
  foldAll(): void;
  unfoldAll(): void;
  openSearch(): void;
  focus(): void;
}

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

  /** Informa la posición del cursor y la longitud del documento. */
  const reportCursor = (state: EditorState) => {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    options.onCursor(line.number, head - line.from + 1, state.doc.length);
  };

  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.initialDoc,
      extensions: [
        basicSetup,
        html({ autoCloseTags: true, matchClosingTags: true }),
        // Tab indenta en lugar de mover el foco. Esc + Tab permite salir del editor
        // con el teclado (comportamiento estándar de CodeMirror para accesibilidad).
        keymap.of([indentWithTab]),
        layoutTheme,
        themeSlot.of(themeExtension(options.theme)),
        fontSlot.of(fontSizeExtension(options.fontSize)),
        wrapSlot.of(wrapExtension(options.wordWrap)),
        EditorView.contentAttributes.of({ 'aria-label': 'Editor de código HTML' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(update.state.doc.toString());
          if (update.docChanged || update.selectionSet) reportCursor(update.state);
        }),
      ],
    }),
  });

  reportCursor(view.state);

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
    },
    setTheme: (theme) => view.dispatch({ effects: themeSlot.reconfigure(themeExtension(theme)) }),
    setFontSize: (px) => view.dispatch({ effects: fontSlot.reconfigure(fontSizeExtension(px)) }),
    setWordWrap: (enabled) => view.dispatch({ effects: wrapSlot.reconfigure(wrapExtension(enabled)) }),
    foldAll: () => foldAll(view),
    unfoldAll: () => unfoldAll(view),
    openSearch() {
      view.focus();
      openSearchPanel(view);
    },
    focus: () => view.focus(),
  };
}
