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
     ┌──────────────┬───────────┼──────────────┬────────────────┐
     ▼              ▼           ▼              ▼                ▼
 editor/        preview/       ui/          file-io.ts     shortcuts.ts
 editor.ts      preview.ts     splitter.ts
 formatter.ts   runtime.ts     dialogs.ts
                console-panel  toast.ts
                devices.ts     theme.ts
                               statusbar.ts
     └──────────────┴───────────┴──────────────┘
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
                     main.ts: handleDocumentChange()
                     ├─ statusBar.setSaveState('pending')
                     ├─ autosave()        (debounce 1 s)  ──► localStorage 'ehv:content'
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

Todos los mensajes llevan `source: 'ehv-preview'`. `preview.ts` ignora cualquier mensaje cuyo `event.source` no sea la ventana de su iframe.

**Scroll entre actualizaciones.** Cada cambio de `srcdoc` recarga el documento desde cero. La app recuerda el último scroll informado y lo pasa como argumento al próximo runtime, que lo restaura en `DOMContentLoaded` y en `load`.

**Dónde se inserta el runtime.** Después de `<head>`; si no hay, después de `<html>`; si no hay, después del `<!DOCTYPE>`. Nunca antes del doctype, porque eso activaría el "modo quirks" y la vista previa no coincidiría con el archivo exportado.

**Por qué `toString()`.** La función `previewRuntime` se escribe en TypeScript (con tipos y verificación) y se convierte a texto con `Function.prototype.toString()`. Por eso debe ser autocontenida: no puede usar nada definido fuera de ella.

## Selector de dispositivos

`transform: scale()` no cambia el espacio que un elemento ocupa en el layout. Para que el marco escalado quede centrado, hay dos capas:

```
#preview-stage (flex, centra)
 └─ #device-shell   tamaño = real × escala   ← lo que se centra
     └─ #device-frame   tamaño real, transform: scale(escala), origen arriba-izquierda
         └─ <iframe>
```

Un `ResizeObserver` sobre el escenario recalcula la escala cuando cambia el tamaño del panel (por el divisor, la ventana o la consola).

## Persistencia

| Clave en localStorage | Contenido | Cuándo se escribe |
| --- | --- | --- |
| `ehv:content` | Texto del editor | 1 s después de la última tecla, y al cerrar si quedaba pendiente |
| `ehv:settings` | Objeto `Settings` (ver `settings.ts`) | Al cambiar cualquier preferencia |

- `storage.ts` envuelve todo en `try/catch`: leer devuelve `null` y escribir devuelve `false` si falla.
- `loadSettings()` mezcla lo guardado con `DEFAULT_SETTINGS`, así las preferencias nuevas de versiones futuras reciben un valor por defecto.
- **Aviso al salir** (`beforeunload`): solo si el autoguardado falló **y** hay cambios sin exportar. En cualquier otro caso, el trabajo ya está a salvo.

## Atajos de teclado

`shortcuts.ts` escucha `keydown` en la fase de **captura** de `window`, antes de que el evento llegue a CodeMirror. Así hay un único lugar que decide qué hace cada atajo (CodeMirror usa `Ctrl+Enter` para otra cosa). Con un diálogo abierto, los atajos se pausan. `Ctrl+/`, deshacer y múltiples cursores los resuelve CodeMirror directamente.

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
- **Web Worker para detectar bucles infinitos:** el código del usuario necesita el DOM, así que no puede correr en un worker. Ver "Limitaciones conocidas" en el README.
