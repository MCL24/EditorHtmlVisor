/**
 * formatter.ts — Formateo de HTML (con CSS y JS internos) usando Prettier.
 *
 * Prettier pesa bastante (~1 MB sin comprimir entre el núcleo y los plugins),
 * así que NO se incluye en la carga inicial: se importa de forma diferida con
 * `import()` la primera vez que el usuario pide formatear. Vite genera chunks
 * separados para estos módulos automáticamente.
 *
 * Plugins necesarios:
 *   - html     → estructura del documento
 *   - postcss  → contenido de <style> y atributos style=""
 *   - babel    → contenido de <script> (parser de JavaScript)
 *   - estree   → impresor de JavaScript (babel lo necesita para generar el código)
 */

type PrettierModule = typeof import('prettier/standalone');
type PrettierPlugin = import('prettier').Plugin;

interface LoadedPrettier {
  prettier: PrettierModule;
  plugins: PrettierPlugin[];
}

/** Promesa compartida: si se pulsa "Formatear" dos veces, se descarga una sola vez. */
let loading: Promise<LoadedPrettier> | null = null;

function loadPrettier(): Promise<LoadedPrettier> {
  loading ??= Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/html'),
    import('prettier/plugins/postcss'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
  ])
    .then(([prettier, htmlPlugin, postcssPlugin, babelPlugin, estreePlugin]) => ({
      prettier,
      plugins: [htmlPlugin, postcssPlugin, babelPlugin, estreePlugin] as PrettierPlugin[],
    }))
    .catch((error: unknown) => {
      // Si falla la descarga (p. ej. sin conexión), permitir reintentar la próxima vez.
      loading = null;
      throw error;
    });
  return loading;
}

/**
 * Formatea el código HTML y devuelve el resultado.
 * Lanza un `Error` con un mensaje legible si el código no se puede parsear;
 * quien llama decide cómo mostrarlo (el contenido original no se toca).
 */
export async function formatHtml(source: string): Promise<string> {
  const { prettier, plugins } = await loadPrettier();
  return prettier.format(source, {
    parser: 'html',
    plugins,
    printWidth: 100,
    tabWidth: 2,
    // 'css' respeta la semántica de espacios de cada elemento según su `display`
    // (es la opción por defecto de Prettier y la más segura para no alterar el render).
    htmlWhitespaceSensitivity: 'css',
  });
}

/**
 * Convierte el error de Prettier en un mensaje corto para mostrar en un aviso.
 * Prettier incluye en el mensaje un fragmento del código con marcas de color ANSI;
 * nos quedamos solo con la primera línea, que describe el problema y su posición.
 */
export function describeFormatError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Quita los códigos de color ANSI (ESC + "[...m") que Prettier agrega al mensaje.
  const firstLine = message.replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0]?.trim();
  return firstLine || 'Error desconocido al formatear.';
}
