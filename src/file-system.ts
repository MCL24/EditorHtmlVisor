/**
 * file-system.ts — Abrir y guardar archivos DIRECTAMENTE en el disco.
 *
 * Usa la "File System Access API" (Chrome, Edge, Opera). Con ella, el usuario
 * elige un archivo una vez y la app puede volver a escribir en él con
 * "Guardar", como un editor de escritorio. Cada archivo se representa con un
 * "handle" (`DiskFileHandle`): una referencia al archivo que da el navegador.
 *
 * En navegadores sin esta API (Firefox, Safari) `FS_SUPPORTED` es `false` y la
 * app usa el método clásico: elegir con <input type="file"> y descargar copias.
 *
 * Los handles no se pueden guardar en localStorage (no son texto), pero sí en
 * IndexedDB. Así, "Guardar" sigue escribiendo en el mismo archivo después de
 * recargar la página. El navegador vuelve a pedir permiso la primera vez que
 * se guarda en cada sesión.
 *
 * Ninguna función de este módulo envía datos a un servidor.
 */

// --- Tipos -------------------------------------------------------------------
// Se declaran acá porque la API no forma parte de los tipos estándar de TypeScript.

type Permission = 'granted' | 'denied' | 'prompt';

/** Referencia a un archivo del disco, entregada por el navegador. */
export interface DiskFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  isSameEntry(other: DiskFileHandle): Promise<boolean>;
  queryPermission?(options: { mode: 'readwrite' }): Promise<Permission>;
  requestPermission?(options: { mode: 'readwrite' }): Promise<Permission>;
}

/** Un archivo abierto: su contenido (`file`) y, si la API está disponible, su handle. */
export interface OpenedFile {
  file: File;
  handle: DiskFileHandle | null;
}

interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}

interface FilePickerWindow {
  showOpenFilePicker(options: { multiple: boolean; types: PickerType[] }): Promise<DiskFileHandle[]>;
  showSaveFilePicker(options: { suggestedName: string; types: PickerType[] }): Promise<DiskFileHandle>;
}

// --- Disponibilidad ----------------------------------------------------------

/** `true` si el navegador permite abrir y guardar archivos del disco directamente. */
export const FS_SUPPORTED = 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;

const pickers = window as unknown as FilePickerWindow;

const HTML_TYPES: PickerType[] = [
  { description: 'Documento HTML', accept: { 'text/html': ['.html', '.htm'] } },
  { description: 'Texto', accept: { 'text/plain': ['.txt'] } },
];

/** El usuario cerró el selector sin elegir nada: no es un error que haya que mostrar. */
function isCancel(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

// --- Abrir y guardar ---------------------------------------------------------

/** Muestra el selector para abrir uno o varios archivos. Devuelve `[]` si se canceló. */
export async function pickFilesToOpen(): Promise<OpenedFile[]> {
  try {
    const handles = await pickers.showOpenFilePicker({ multiple: true, types: HTML_TYPES });
    return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
  } catch (error) {
    if (isCancel(error)) return [];
    throw error;
  }
}

/** Muestra el selector "Guardar como". Devuelve `null` si se canceló. */
export async function pickSaveTarget(suggestedName: string): Promise<DiskFileHandle | null> {
  try {
    return await pickers.showSaveFilePicker({ suggestedName, types: HTML_TYPES });
  } catch (error) {
    if (isCancel(error)) return null;
    throw error;
  }
}

/**
 * Escribe `text` en el archivo, reemplazando su contenido.
 * Si hace falta, pide permiso de escritura (el navegador muestra un aviso).
 * Lanza un error si el usuario no da permiso o si el archivo ya no existe.
 */
export async function writeFile(handle: DiskFileHandle, text: string): Promise<void> {
  if (handle.queryPermission && handle.requestPermission) {
    const options = { mode: 'readwrite' } as const;
    let permission = await handle.queryPermission(options);
    if (permission !== 'granted') permission = await handle.requestPermission(options);
    if (permission !== 'granted') throw new DOMException('Sin permiso de escritura', 'NotAllowedError');
  }
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close(); // recién acá el contenido queda escrito en el disco
}

/** Mensaje entendible para un error al guardar. */
export function describeWriteError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'no se dio permiso para escribir en el archivo';
    if (error.name === 'NotFoundError') return 'el archivo ya no existe (¿se movió o se borró?)';
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Handles de los archivos soltados sobre la app (solo Chrome/Edge).
 *
 * ⚠️ Debe llamarse DURANTE el evento `drop`: después, el navegador vacía
 * `dataTransfer` y ya no se pueden pedir.
 */
export function filesFromDrop(dataTransfer: DataTransfer): Promise<OpenedFile[]> {
  type DropItem = DataTransferItem & { getAsFileSystemHandle?: () => Promise<{ kind: string } | null> };
  const pending = [...dataTransfer.items]
    .filter((item) => item.kind === 'file')
    .map((item: DropItem) => {
      const file = item.getAsFile();
      const handle = FS_SUPPORTED && item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : Promise.resolve(null);
      return { file, handle };
    });

  return Promise.all(
    pending.map(async ({ file, handle }) => {
      const resolved = await handle.catch(() => null);
      // Una carpeta soltada tiene kind === 'directory': se trata como archivo sin handle (y se rechazará).
      return { file, handle: resolved?.kind === 'file' ? (resolved as DiskFileHandle) : null };
    }),
  ).then((entries) => entries.filter((entry): entry is OpenedFile => entry.file !== null));
}

// --- Recordar handles entre sesiones (IndexedDB) -----------------------------
// Si IndexedDB no está disponible (p. ej. modo privado), estas funciones no
// hacen nada: la app sigue funcionando, solo que después de recargar
// "Guardar" pedirá elegir el archivo de nuevo.

const DB_NAME = 'ehv-files';
const STORE = 'handles';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Ejecuta una operación sobre el almacén de handles. Nunca lanza. */
async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  if (!FS_SUPPORTED) return null; // sin la API no hay handles que guardar
  try {
    const db = await openDatabase();
    return await new Promise<T | null>((resolve) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    }).finally(() => db.close());
  } catch {
    return null;
  }
}

/** Recuerda el handle del documento `id`, o lo olvida si es `null`. */
export function rememberHandle(id: string, handle: DiskFileHandle | null): void {
  if (handle) void withStore('readwrite', (store) => store.put(handle, id));
  else void withStore('readwrite', (store) => store.delete(id));
}

/** Devuelve el handle recordado de cada documento, por id. */
export async function loadHandles(ids: string[]): Promise<Map<string, DiskFileHandle>> {
  const result = new Map<string, DiskFileHandle>();
  await Promise.all(
    ids.map(async (id) => {
      const handle = await withStore<DiskFileHandle | undefined>('readonly', (store) => store.get(id));
      if (handle) result.set(id, handle);
    }),
  );
  return result;
}

/** Borra los handles de documentos que ya no están abiertos. */
export function forgetHandlesExcept(ids: string[]): void {
  void withStore('readwrite', (store) => {
    const request = store.getAllKeys();
    // addEventListener (y no onsuccess): withStore usa onsuccess para resolver.
    // Los delete corren en la misma transacción; db.close() espera a que terminen.
    request.addEventListener('success', () => {
      for (const key of request.result) if (!ids.includes(String(key))) store.delete(key);
    });
    return request;
  });
}
