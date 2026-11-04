# Arquitectura

Este documento explica cómo se organiza el código y cómo viajan los datos entre los módulos. Para instalar y usar la app, ver el [README](../README.md).

## Principios

1. **Un módulo, una responsabilidad.** Cada archivo hace una sola cosa y lo dice en su comentario de cabecera.
2. **`main.ts` solo conecta piezas.** No tiene lógica de detalle: crea los módulos y les pasa callbacks. Si querés saber *qué pasa cuando…*, empezá por ahí.
3. **Los módulos no se conocen entre sí.** `Preview` no sabe que existe `ConsolePanel`; solo llama a `onConsole`. Eso permite cambiar o probar cada pieza por separado.
4. **Configuración centralizada.** Tiempos, límites y dispositivos están en `config.ts`; colores, en `styles/base.css`.
5. **Nada de backend.** Todo corre en el navegador.

## Mapa de módulos

```
                         ┌──────────────┐
                         │   main.ts    │  crea y conecta todo
                         └──────┬───────┘
     ┌──────────────┬───────────┼──────────────┬────────────────┬──────────────┐
     ▼              ▼           ▼              ▼                ▼              ▼
 editor/        preview/       ui/          documents.ts    file-io.ts     shortcuts.ts
 editor.ts      preview.ts     splitter.ts                  file-system.ts
 formatter.ts   runtime.ts     dialogs.ts
                source-map.ts  toast.ts
                console-panel  statusbar.ts
                devices.ts     theme.ts
                               doc-tabs.ts
     └──────────────┴───────────┴──────────────┴────────────────┘
                          │
              config.ts · settings.ts · storage.ts · utils.ts
```

## Flujo principal: de la tecla a la vista previa

```
Usuario escribe
   │
   ▼
CodeMirror (editor.ts) ── updateListener ──► onChange(doc)
                                                │
                     main.ts: handleDocumentChange(text)
                     ├─ doc.content = text; doc.dirty = true   (documento activo)
                     ├─ statusBar.setSaveState('pending')
                     ├─ autosave()        (debounce 1 s)  ──► localStorage 'ehv:documents'
                     └─ scheduleRender()  (debounce 300 ms, solo si Auto está activo)
                                                │
                                                ▼
                                   preview.render(html)
                                   ├─ consolePanel.clear()     (vía onBeforeRender)
                                   ├─ buildRuntimeScript(scrollX, scrollY)
                                   ├─ injectRuntime(html, script)
                                   └─ iframe.srcdoc = resultado
```

## El visor y su runtime

La vista previa es un `<iframe>` con `sandbox="allow-scripts allow-modals allow-forms allow-popups"`, **sin** `allow-same-origin`. Por eso la app no puede leer el interior del iframe, y el iframe tampoco puede leer la app.

Para saber qué pasa adentro, `runtime.ts` inyecta un pequeño script **al principio** del HTML del usuario, antes de que se ejecuten sus scripts:

| Qué hace el runtime | Mensaje que envía a la app |
| --- | --- |
| Envuelve `console.log/info/warn/error/debug` | `{ type: 'console', level, args }` |
| Escucha `error` y `unhandledrejection` | `{ type: 'error', message, location }` |
| Informa el scroll (una vez por cuadro) | `{ type: 'scroll', x, y }` |
| Reenvía Esc | `{ type: 'key', key: 'Escape' }` |
| Describe la selección de texto | `{ type: 'selection', start, end }` |

Todos los mensajes llevan `source: 'ehv-preview'`. `preview.ts` ignora cualquier mensaje cuyo `event.source` no sea la ventana de su iframe.

**En sentido contrario (app → iframe)** hay un solo mensaje: `{ source: 'ehv-app', type: 'print' }`, que usa **Exportar → PDF**. La app no puede llamar a `print()` del iframe directamente, porque tienen orígenes distintos. Por eso se lo pide al runtime, que:

1. verifica que el mensaje venga de `window.parent`;
2. agrega un `<style>` temporal con `print-color-adjust: exact`, para que se impriman los fondos;
3. llama a `window.print()`.

Al llamar a `print()` desde dentro del iframe, se imprime solo ese documento, sin la interfaz de la app. Para eso hace falta `allow-modals` en el sandbox. El estilo temporal se quita en `afterprint`. Antes de enviar el mensaje, `Preview.print()` espera el evento `load` del último render, para no imprimir una página a medio cargar.

**Scroll entre actualizaciones.** Cada cambio de `srcdoc` recarga el documento desde cero. La app recuerda el último scroll informado y lo pasa como argumento al próximo runtime, que lo restaura en `DOMContentLoaded` y en `load`.

**Dónde se inserta el runtime.** Después de `<head>`; si no hay, después de `<html>`; si no hay, después del `<!DOCTYPE>`. Nunca antes del doctype, porque eso activaría el "modo quirks" y la vista previa no coincidiría con el archivo exportado.

**Por qué `toString()`.** La función `previewRuntime` se escribe en TypeScript (con tipos y verificación) y se convierte a texto con `Function.prototype.toString()`. Por eso debe ser autocontenida: no puede usar nada definido fuera de ella.

## Localizar en el código

Al seleccionar texto en el visor, el editor resalta el código que lo genera. La lógica está en `preview/source-map.ts` y funciona en dos pasos.

**1. Anotar (en cada render).** El HTML se analiza con `@lezer/html`, el mismo parser que usa CodeMirror. En la copia que va al iframe se agrega a cada etiqueta de apertura la posición de su `<` en el código original:

```
<p class="a">Hola</p>   →   <p data-ehv-src="0" class="a">Hola</p>
```

El árbol sintáctico se guarda como "instantánea" (`SourceSnapshot`) junto con el código renderizado.

**2. Localizar (al seleccionar).** El runtime escucha `selectionchange` (espera 150 ms a que termine el arrastre) y describe cada extremo de la selección con un `SelectionEndpoint`:

| Campo | Significado |
| --- | --- |
| `src` | `data-ehv-src` del elemento anotado más cercano |
| `gap` | Hueco de texto dentro de ese elemento (cuántos elementos o comentarios hermanos lo preceden) |
| `text` | Texto seleccionado dentro del nodo (hasta 300 caracteres) |
| `before` | Caracteres del nodo antes de `text`, para desempatar textos repetidos |
| `edge` | Si el extremo cae en un borde de elemento: su inicio o su final |

En la app, `locateSelection()` busca el elemento por posición en el árbol y el texto dentro del hueco indicado. La búsqueda tolera saltos de línea y espacios múltiples, y entidades como `&amp;`, `&lt;` o `&nbsp;`. Si hay varias coincidencias, elige la más cercana a `before`. Si no encuentra el texto (por ejemplo, porque lo generó JavaScript), usa el elemento entero.

**Resaltado.** `editor.ts` usa un `StateField` con una decoración (`.cm-source-highlight`), no la selección del editor. Así no mueve el cursor ni le quita el foco al visor. El resaltado se borra al editar, porque a partir de ese momento el visor muestra otra versión.

**Código desactualizado.** Si el código del editor ya no es el que se renderizó (con Auto apagado), `main.ts` no resalta nada y muestra un aviso.

## Selector de dispositivos

`transform: scale()` no cambia el espacio que un elemento ocupa en el layout. Para que el marco escalado quede centrado, hay dos capas:

```
#preview-stage (flex, centra)
 └─ #device-shell   tamaño = real × escala   ← lo que se centra
     └─ #device-frame   tamaño real, transform: scale(escala), origen arriba-izquierda
         └─ <iframe>
```

Un `ResizeObserver` sobre el escenario recalcula la escala cuando cambia el tamaño del panel (por el divisor, la ventana o la consola).

## Publicación

`.github/workflows/deploy.yml` compila y publica `dist/` en GitHub Pages en cada push a `main`. Funciona gracias a `base: './'` en `vite.config.ts`, que hace que todas las rutas sean relativas y el sitio funcione dentro de `/EditorHtmlVisor/`.

## Documentos y archivos

Se pueden tener varios documentos abiertos, uno por pestaña. Las piezas son:

| Módulo | Qué hace |
| --- | --- |
| `documents.ts` | Los datos: nombre, contenido, `dirty` (cambios sin guardar en el archivo) y `handle` (el archivo del disco, o `null`). También los lee y guarda en localStorage. |
| `ui/doc-tabs.ts` | Dibuja las pestañas y avisa de clics: elegir, cerrar, nuevo. |
| `file-system.ts` | Abrir y guardar en el disco con la *File System Access API*, y recordar los handles en IndexedDB. |
| `editor/editor.ts` | `showDocument(id, texto)`: cambia el documento visible conservando su historial. |
| `main.ts`, sección 6 | Las reglas: qué pasa al abrir, guardar o cerrar. |

**Un editor, muchos estados.** Hay una sola vista de CodeMirror. Cada documento tiene su `EditorState` (texto, historial de deshacer, cursor, plegados). Al cambiar de pestaña, el editor guarda el estado actual y muestra el otro con `view.setState`. `setState` no pasa por el `updateListener`, así que cambiar de pestaña no marca el documento como modificado. Las opciones globales (tema, fuente, ajuste) se vuelven a aplicar al estado restaurado, porque pudieron cambiar mientras estaba oculto. El visor recuerda también el scroll de cada documento (`doc.previewScroll`).

**Abrir.**
- En Chrome y Edge, `showOpenFilePicker` devuelve, para cada archivo elegido, su contenido y un handle que permite volver a escribir en él.
- En Firefox y Safari se usa `<input type="file" multiple>`, que solo da el contenido.
- Al arrastrar archivos, `filesFromDrop` pide los handles con `getAsFileSystemHandle()`. Esto tiene que hacerse durante el evento `drop`, porque después el navegador vacía `dataTransfer`.
- Si un archivo ya estaba abierto (`isSameEntry`), se pasa a su pestaña en lugar de duplicarlo.
- Si la pestaña activa es "descartable" (sin archivo, sin cambios, vacía o con el ejemplo), el primer archivo abierto la reemplaza.

**Guardar.**
- Si el documento tiene handle, `writeFile` escribe directamente en el archivo. Si hace falta, antes pide permiso con `requestPermission`. Si no tiene handle, funciona como "Guardar como": `showSaveFilePicker` y, desde ahí, el documento queda vinculado al archivo elegido.
- Sin la API, "Guardar" abre el diálogo Exportar, que descarga una copia.
- `dirty` se calcula comparando con el texto que se escribió en el archivo. Así, si se sigue tipeando mientras se guarda, el documento sigue marcado como modificado.

**Handles entre sesiones.** Un handle no es texto y no puede ir a localStorage, pero sí a IndexedDB (`ehv-files`, una entrada por id de documento). Al arrancar se cargan de forma asíncrona y se borran los de documentos que ya no están abiertos. Después de recargar la página, el navegador vuelve a pedir permiso la primera vez que se guarda. Por eso se pide en el momento de guardar, que es cuando hay un gesto del usuario.

## Persistencia

| Dónde | Clave | Contenido | Cuándo se escribe |
| --- | --- | --- | --- |
| localStorage | `ehv:documents` | Documentos abiertos (`{ version, activeId, docs: [{ id, name, content, dirty }] }`) | 1 s después de la última tecla o de cualquier cambio de pestañas, y al cerrar la página si quedaba pendiente |
| localStorage | `ehv:settings` | Objeto `Settings` (ver `settings.ts`) | Al cambiar cualquier preferencia |
| IndexedDB | `ehv-files` / `handles` | Handle del archivo de cada documento | Al abrir, guardar como o cerrar |

- **Migración:** versiones anteriores guardaban un único documento en `ehv:content`. Si `loadDocuments()` no encuentra `ehv:documents`, convierte ese contenido en el primer documento. La clave vieja se borra después del primer autoguardado exitoso.

- `storage.ts` envuelve todo en `try/catch`: leer devuelve `null` y escribir devuelve `false` si falla.
- `loadSettings()` mezcla lo guardado con `DEFAULT_SETTINGS`, así las preferencias nuevas de versiones futuras reciben un valor por defecto.
- **Aviso al salir** (`beforeunload`): solo si el autoguardado falló **y** algún documento tiene cambios sin guardar. En cualquier otro caso, el trabajo ya está a salvo en el navegador.

## Atajos de teclado

`shortcuts.ts` escucha `keydown` en la fase de **captura** de `window`, antes de que el evento llegue a CodeMirror. Así hay un único lugar que decide qué hace cada atajo (CodeMirror usa `Ctrl+Enter` para otra cosa). Además, `preventDefault` evita las acciones propias del navegador para `Ctrl+S` (guardar la página) y `Ctrl+O` (abrir un archivo). Con un diálogo abierto, los atajos se pausan. `Ctrl+/`, deshacer y múltiples cursores los resuelve CodeMirror directamente.

## Tema

1. Un script en línea dentro de `index.html` fija `data-theme` antes de pintar la página (evita un parpadeo).
2. `ThemeController` (`ui/theme.ts`) toma el control: si el usuario nunca eligió un tema, sigue a `prefers-color-scheme` incluso en vivo; si eligió uno, lo guarda.
3. El CSS cambia de tema con variables bajo `:root[data-theme='dark']`. El editor cambia entre `oneDark` y un tema claro mediante un `Compartment` de CodeMirror.

## Carga diferida de Prettier

`formatter.ts` importa Prettier con `import()` solo la primera vez que se pide formatear. Vite genera chunks separados (núcleo + plugins html, postcss, babel y estree, unos 260 kB gzip). La promesa se guarda para no descargar dos veces; si la descarga falla, se descarta para permitir reintentar.

## Cómo agregar…

- **Un botón nuevo en la barra:** agregá el `<button id="btn-x">` en `index.html` (dentro del grupo que corresponda) y en `main.ts`, sección 8, `onClick('btn-x', acción)`.
- **Un dispositivo nuevo:** agregalo a `DEVICE_PRESETS` y a `DeviceId` en `config.ts`. El `<select>` se llena solo.
- **Una preferencia persistente:** agregá el campo a `Settings` y a `DEFAULT_SETTINGS` en `settings.ts`, y guardala con `updateSettings({ … })` desde `main.ts`.
- **Un atajo:** agregá la acción a `ShortcutActions` en `shortcuts.ts`, la condición de tecla en el listener y la implementación en `main.ts`, sección 9. Documentalo también en la ayuda de `index.html` y en el README.

## Decisiones descartadas

- **React:** la interfaz es una sola pantalla con estado simple. Vanilla TS con módulos chicos alcanza y evita una capa extra.
- **Abrir en pestaña nueva con una URL `blob:` directa:** tendría el mismo origen que la app y el código del usuario podría leer su `localStorage`. Se usa una página contenedora con un iframe sandbox.
- **Generar el PDF con una librería (jsPDF, html2canvas, etc.):** sumaría cientos de kB y el resultado sería una imagen o una aproximación del HTML. El motor de impresión del navegador produce texto seleccionable, respeta `@media print` y no agrega dependencias.
- **Web Worker para detectar bucles infinitos:** el código del usuario necesita el DOM, así que no puede correr en un worker. Ver "Limitaciones conocidas" en el README.
