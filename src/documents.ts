/**
 * documents.ts — Los documentos abiertos (una pestaña por documento).
 *
 * Cada documento tiene:
 *   - un nombre (el del archivo, o "sin-titulo.html" si es nuevo);
 *   - su contenido;
 *   - `dirty`: si tiene cambios que todavía no se guardaron en el archivo;
 *   - `handle`: el archivo del disco al que se guarda (ver file-system.ts),
 *     o `null` si solo existe en el navegador.
 *
 * Persistencia: nombres, contenidos y cuál está activo se autoguardan en
 * localStorage (clave `ehv:documents`). Los handles van aparte, en IndexedDB,
 * porque localStorage solo guarda texto.
 *
 * Este módulo solo maneja datos: no sabe nada del editor ni de la interfaz.
 */

import { CONFIG, STORAGE_KEYS } from './config';
import type { DiskFileHandle } from './file-system';
import { readJson, readText, removeKey, writeJson } from './storage';

export interface DocumentData {
  id: string;
  name: string;
  content: string;
  dirty: boolean;
}

export interface OpenDocument extends DocumentData {
  handle: DiskFileHandle | null;
  /** Scroll del visor para este documento, para restaurarlo al volver a la pestaña. */
  previewScroll: { x: number; y: number };
}

/** Forma en que se guarda en localStorage. */
interface StoredDocuments {
  version: 1;
  activeId: string;
  docs: DocumentData[];
}

/** Crea un documento en memoria. */
export function createDocument(name: string, content: string, handle: DiskFileHandle | null = null): OpenDocument {
  return { id: newId(), name, content, dirty: false, handle, previewScroll: { x: 0, y: 0 } };
}

function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Nombre que no usa ningún documento abierto: sin-titulo.html, sin-titulo-2.html, … */
export function uniqueName(docs: readonly OpenDocument[], base = 'sin-titulo'): string {
  const taken = new Set(docs.map((doc) => doc.name.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${base}.html` : `${base}-${n}.html`;
    if (!taken.has(name)) return name;
  }
}

/**
 * Lee los documentos guardados. Devuelve `null` si no hay ninguno.
 *
 * Migración: las versiones anteriores guardaban un único documento en
 * `ehv:content`. Si se encuentra, se convierte en el primer documento.
 */
export function loadDocuments(): { docs: OpenDocument[]; activeId: string } | null {
  const stored = readJson<StoredDocuments>(STORAGE_KEYS.documents);
  if (stored?.version === 1 && Array.isArray(stored.docs) && stored.docs.length > 0) {
    const docs = stored.docs
      .filter((doc) => typeof doc?.id === 'string' && typeof doc.content === 'string')
      .map<OpenDocument>((doc) => ({
        id: doc.id,
        name: typeof doc.name === 'string' && doc.name ? doc.name : CONFIG.defaultExportName,
        content: doc.content,
        dirty: doc.dirty === true,
        handle: null, // se completan después, desde IndexedDB
        previewScroll: { x: 0, y: 0 },
      }));
    if (docs.length > 0) {
      const activeId = docs.some((doc) => doc.id === stored.activeId) ? stored.activeId : docs[0].id;
      return { docs, activeId };
    }
  }

  const legacy = readText(STORAGE_KEYS.legacyContent);
  if (legacy !== null) {
    const doc = createDocument(CONFIG.defaultExportName, legacy);
    return { docs: [doc], activeId: doc.id };
  }
  return null;
}

/** Guarda los documentos. Devuelve `false` si falló (p. ej. almacenamiento lleno). */
export function saveDocuments(docs: readonly OpenDocument[], activeId: string): boolean {
  const data: StoredDocuments = {
    version: 1,
    activeId,
    docs: docs.map(({ id, name, content, dirty }) => ({ id, name, content, dirty })),
  };
  const ok = writeJson(STORAGE_KEYS.documents, data);
  // Ya migrado: el formato viejo no hace falta.
  if (ok) removeKey(STORAGE_KEYS.legacyContent);
  return ok;
}
