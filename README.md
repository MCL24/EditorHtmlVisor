# Editor HTML Visor

Editor de HTML con vista previa en vivo y pantalla dividida. Escribís a la izquierda y ves el resultado a la derecha mientras tipeás.

**Probalo online:** https://mcl24.github.io/EditorHtmlVisor/

**Todo funciona en tu navegador.** No hay backend: tu código no se envía a ningún servidor. Se autoguarda en el `localStorage` de tu navegador y, si lo pedís, en tus propios archivos del disco.

## Requisitos

- Node.js 20 o superior
- npm

## Uso rápido

```bash
npm install       # instalar dependencias
npm run dev       # servidor de desarrollo en http://localhost:5173
npm run build     # verificar tipos y generar la versión de producción en dist/
npm run preview   # servir dist/ localmente para probar el build
```

## Publicación

Cada push a `main` publica automáticamente la app en GitHub Pages mediante el workflow [.github/workflows/deploy.yml](.github/workflows/deploy.yml): instala dependencias, ejecuta `npm run build` y sube `dist/`. El progreso se ve en la pestaña **Actions** del repositorio.

Requisito, una sola vez: en GitHub, **Settings → Pages → Build and deployment → Source: GitHub Actions**.

`dist/` es un sitio estático: se puede publicar en cualquier hosting estático (GitHub Pages, Netlify, un bucket, etc.). Como usa rutas relativas (`base: './'`), también funciona dentro de una subcarpeta.

## Funcionalidades

| Área | Qué hace |
| --- | --- |
| **Editor** | CodeMirror 6 con resaltado de HTML + CSS + JS embebido, autocompletado y cierre automático de etiquetas, resaltado de la etiqueta par, plegado, indentación automática, múltiples cursores, ajuste de línea y tamaño de fuente ajustable. |
| **Vista previa** | Se actualiza sola al escribir (espera ~300 ms). Conserva la posición de scroll entre actualizaciones. Se puede apagar con el interruptor **Auto**. |
| **Localizar en el código** | Seleccioná texto en la vista previa y el editor resalta el código que lo genera, desplazándose hasta él. Se activa o desactiva con el botón de la mira en la barra del visor. |
| **Consola** | Muestra `console.log/info/warn/error/debug` y los errores no controlados de tu página, en un panel colapsable bajo el visor. |
| **Dispositivos** | Escritorio, Tablet (768×1024), Móvil (375×667) y Personalizado. Rotación vertical/horizontal y escala automática si no entra en el panel. |
| **Varios documentos** | Cada archivo se abre en su propia pestaña, arriba del editor. Cada pestaña conserva su historial de deshacer, cursor y scroll. **+** crea un documento vacío y **×** lo cierra; si tiene cambios sin guardar (●), pide confirmación. Hasta 20 documentos a la vez. |
| **Abrir y guardar** | **Abrir** acepta varios `.html/.htm/.txt` a la vez (máx. 5 MB cada uno), también arrastrándolos al editor. **Guardar** escribe directamente en el archivo original y **Guardar como…** elige otro destino (Chrome y Edge). En Firefox y Safari, que no permiten escribir archivos, se descarga una copia. |
| **Exportar** | Descargar una copia `.html` con nombre editable, copiar al portapapeles o exportar a PDF. |
| **PDF** | En **Exportar → PDF (vista previa)** se abre el diálogo de impresión del navegador con *solo* el contenido del visor, sin el código ni la interfaz. Como destino, elegí **Guardar como PDF**. |
| **Formatear** | Prettier (HTML + CSS + JS). Se descarga recién la primera vez que lo usás. |
| **Interfaz** | Divisor arrastrable (doble clic = 50/50), tema claro/oscuro, pantalla completa del visor, pestañas en pantallas angostas, ayuda con atajos. |
| **Persistencia** | Autoguardado de todos los documentos abiertos (~1 s), incluidos los cambios todavía no guardados en el archivo, y de las preferencias: tema, proporción de paneles, dispositivo, auto-actualización, ajuste de línea, tamaño de fuente y estado de la consola. Después de recargar, **Guardar** sigue escribiendo en el mismo archivo (el navegador vuelve a pedir permiso). |

## Atajos de teclado

En macOS, `Ctrl` es `⌘` y `Alt` es `⌥`.

| Atajo | Acción |
| --- | --- |
| `Ctrl+Enter` | Previsualizar |
| `Ctrl+O` | Abrir archivos |
| `Ctrl+S` | Guardar |
| `Ctrl+Shift+S` | Guardar como… |
| `Shift+Alt+F` | Formatear |
| `Ctrl+F` | Buscar y reemplazar |
| `Ctrl+/` | Comentar / descomentar |
| `Ctrl+D` | Seleccionar la siguiente coincidencia (múltiples cursores) |
| `Alt+clic` | Agregar un cursor |
| `Esc` | Salir de pantalla completa / cerrar ventanas |
| `Esc`, luego `Tab` | Salir del editor con el teclado |

## Estructura del proyecto

```
├── index.html                 Estructura de la página (barras, paneles, diálogos, iconos)
├── .github/workflows/
│   └── deploy.yml             Publicación automática en GitHub Pages
├── public/favicon.svg
├── vite.config.ts
├── tsconfig.json
├── docs/
│   └── ARQUITECTURA.md        Cómo encajan las piezas, flujo de datos y decisiones
└── src/
    ├── main.ts                Punto de entrada: crea los módulos y los conecta
    ├── config.ts              Valores ajustables (tiempos, límites, dispositivos)
    ├── settings.ts            Preferencias persistentes
    ├── storage.ts             Acceso a localStorage que nunca lanza errores
    ├── shortcuts.ts           Atajos de teclado globales
    ├── documents.ts           Documentos abiertos (pestañas) y su autoguardado
    ├── file-system.ts         Abrir y guardar directamente en el disco
    ├── file-io.ts             Validar archivos, descargar copias, portapapeles, arrastrar y soltar
    ├── sample.ts              HTML de ejemplo del botón "Muestra"
    ├── utils.ts               debounce, clamp, byId, etc.
    ├── editor/
    │   ├── editor.ts          Configuración de CodeMirror 6
    │   └── formatter.ts       Prettier con carga diferida
    ├── preview/
    │   ├── preview.ts         iframe aislado, render y mensajes
    │   ├── runtime.ts         Script inyectado en el iframe (consola, errores, scroll)
    │   ├── source-map.ts      Localizar en el código (visor → posición en el código)
    │   ├── console-panel.ts   Panel de consola
    │   └── devices.ts         Selector de dispositivo y escalado
    ├── ui/
    │   ├── splitter.ts        Divisor arrastrable
    │   ├── dialogs.ts         Confirmación, exportar, ayuda (<dialog> nativo)
    │   ├── toast.ts           Avisos emergentes
    │   ├── theme.ts           Tema claro/oscuro
    │   ├── doc-tabs.ts        Pestañas de documentos
    │   └── statusbar.ts       Barra de estado
    └── styles/
        ├── index.css          Importa los demás
        ├── base.css           Variables CSS de ambos temas + reset
        ├── layout.css         Estructura y responsive
        ├── components.css     Botones, inputs, diálogos, avisos
        └── preview.css        Visor, marco de dispositivo, consola
```

Para entender cómo se comunican los módulos, empezá por [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) y después leé [src/main.ts](src/main.ts), que está ordenado por secciones.

## Personalización

Casi todo lo ajustable está en [src/config.ts](src/config.ts):

- `previewDebounceMs`: espera antes de refrescar el visor (por defecto 300 ms).
- `autosaveDebounceMs`: espera antes de autoguardar (por defecto 1000 ms).
- `maxImportBytes`: tamaño máximo de cada archivo al abrirlo (5 MB).
- `maxOpenDocuments`: documentos abiertos a la vez (20).
- `sourceMapMaxChars`: tamaño máximo de documento para "Localizar en el código" (1.000.000 caracteres).
- `minPaneWidthPx`: ancho mínimo de cada panel (200 px).
- `DEVICE_PRESETS`: dispositivos del selector y sus tamaños.

Los colores están en [src/styles/base.css](src/styles/base.css), como variables CSS para cada tema.

## Seguridad

El código del usuario se ejecuta en un `<iframe>` con:

```
sandbox="allow-scripts allow-modals allow-forms allow-popups"
```

**Sin `allow-same-origin`.** Por eso el iframe tiene un origen opaco y su código **no puede**:

- leer ni escribir el `localStorage` de la app (donde está tu código guardado);
- acceder al DOM de la app (`window.parent.document` lanza un error);
- leer cookies del sitio.

La comunicación con la app es solo por `postMessage`. La app solo acepta mensajes cuyo `event.source` sea la ventana de su propio iframe.

**Abrir en pestaña nueva** no abre tu HTML directamente (una URL `blob:` tendría el mismo origen que la app). Abre una página contenedora mínima que muestra tu HTML dentro de un iframe con el mismo sandbox.

## Limitaciones conocidas

- **Bucles infinitos.** Si tu código entra en un bucle infinito (`while (true) {}`), la pestaña entera se congela: el iframe sandbox comparte el hilo principal con la app y no hay forma de interrumpir un script síncrono desde afuera. La única protección es el interruptor **Auto**: si lo apagás, el visor no se refresca mientras escribís, así que podés corregir el código y recién después pulsar **Previsualizar**. Si la pestaña ya se congeló, cerrala y volvé a abrir la app: tu código estará restaurado desde el último autoguardado.
- **Atajos con el foco en el visor.** Si hacés clic dentro de la vista previa, el teclado queda dentro del iframe y los atajos de la app no funcionan (salvo `Esc`, que se reenvía). Hacé clic en el editor para recuperarlos.
- **Recursos relativos.** Rutas como `<img src="foto.jpg">` o `<link href="estilos.css">` no se resuelven, porque el documento no tiene una ubicación real. Usá URLs absolutas (`https://…`) o recursos embebidos.
- **APIs que requieren origen.** Dentro del visor no funcionan `localStorage`, `sessionStorage`, `IndexedDB` ni cookies (lanzan errores de seguridad), consecuencia directa de no usar `allow-same-origin`.
- **Guardar en el disco.**
  - Escribir directamente en tus archivos solo funciona en Chrome, Edge y otros navegadores basados en Chromium. En Firefox y Safari, **Guardar** descarga una copia (normalmente a la carpeta Descargas).
  - La primera vez que guardás en un archivo, en cada sesión, el navegador pide permiso.
  - Si el archivo se movió, se renombró o se borró desde fuera de la app, **Guardar** avisa del error; usá **Guardar como…**.
  - La app no detecta si otro programa modificó el archivo mientras lo tenías abierto: al guardar, se sobrescribe con el contenido del editor.
- **Varios documentos y espacio.** Todos los documentos abiertos se autoguardan en `localStorage`, que suele tener unos 5 MB en total. Si se llena, la barra de estado muestra "Sin autoguardado". Tus archivos guardados en el disco no se ven afectados, pero conviene cerrar pestañas que no uses.
- **Modo privado.** Si el navegador bloquea `localStorage`, la app funciona igual pero sin autoguardado; la barra de estado muestra "Sin autoguardado" y, al cerrar la pestaña del navegador con cambios sin guardar, se pide confirmación.
- **Localizar en el código.**
  - Para funcionar, la copia del HTML que va al visor lleva un atributo `data-ehv-src` en cada etiqueta. El editor y el archivo exportado no lo tienen, pero el código de tu página sí lo ve (por ejemplo, en `outerHTML` o en las DevTools). Si te molesta, desactivá la función con el botón de la mira y el visor vuelve a mostrar tu HTML sin cambios.
  - El texto que genera JavaScript no existe en el código: en ese caso se resalta el elemento que lo contiene.
  - Si apagaste **Auto** y editaste después de la última vista previa, las posiciones ya no coinciden: la app avisa y pide pulsar **Previsualizar**.
  - Por encima de `sourceMapMaxChars` la función se desactiva sola, para no volver lenta la escritura.
- **PDF.**
  - El PDF lo genera el navegador al imprimir, no la app. Por eso respeta tus estilos `@media print` y los saltos de página (`break-before`, `break-inside`, etc.).
  - El contenido se reacomoda al ancho del papel, sin importar el dispositivo que elegiste en el visor.
  - Los colores y las imágenes de fondo se imprimen tal como se ven. Si no los querés, en tu CSS poné `html { print-color-adjust: economy; }`.
  - El nombre del archivo lo propone el navegador, y suele ser el título de la app. Podés cambiarlo en la ventana de guardado.
  - Si el visor estaba desactualizado (con **Auto** apagado), se actualiza antes de imprimir. Esto reinicia los scripts de la página, así que se pierde cualquier estado que tuviera, por ejemplo un contador.
- **Formateo.** Prettier necesita descargarse la primera vez (requiere conexión si la app no se sirve localmente). Si el HTML tiene errores de sintaxis graves (p. ej. una etiqueta de cierre que no corresponde), se muestra un aviso y el código queda intacto. En cambio, si el error está *dentro* de un `<script>` o `<style>`, Prettier no lo informa: formatea el resto del documento y deja ese bloque como estaba.
