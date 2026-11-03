/**
 * sample.ts — Documento de ejemplo que carga el botón "Muestra".
 *
 * Incluye HTML, CSS (variables, grid, media query) y algo de JavaScript
 * (eventos, console.log y console.warn) para probar el visor, la consola
 * y el selector de dispositivos.
 */

export const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Página de ejemplo</title>
  <style>
    :root {
      --accent: #2f6fde;
      --bg: #f6f7fb;
      --card: #ffffff;
      --text: #1d2433;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    header {
      padding: 48px 24px;
      text-align: center;
      background: linear-gradient(135deg, var(--accent), #7b4fd6);
      color: white;
    }
    header h1 { margin: 0 0 8px; font-size: 2rem; }
    main {
      max-width: 900px;
      margin: 0 auto;
      padding: 32px 24px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }
    .card {
      background: var(--card);
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 2px 8px rgb(0 0 0 / 0.06);
    }
    button {
      font: inherit;
      padding: 8px 16px;
      border: 0;
      border-radius: 8px;
      background: var(--accent);
      color: white;
      cursor: pointer;
    }
    button:hover { filter: brightness(1.1); }
    #contador { font-size: 2.5rem; font-weight: 700; margin: 8px 0; }

    /* Probá el selector de dispositivo: en pantallas angostas las tarjetas se apilan. */
    @media (max-width: 700px) {
      main { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>¡Hola, mundo!</h1>
    <p>Editá el código de la izquierda y mirá el resultado al instante.</p>
  </header>

  <main>
    <section class="card">
      <h2>Contador</h2>
      <p id="contador">0</p>
      <button id="sumar">Sumar uno</button>
    </section>

    <section class="card">
      <h2>Consola</h2>
      <p>Este botón escribe en el panel de consola, debajo del visor.</p>
      <button id="log">Escribir mensajes</button>
    </section>

    <section class="card">
      <h2>Responsive</h2>
      <p>Elegí «Móvil» en la barra del visor para ver cómo se reacomodan las tarjetas.</p>
    </section>
  </main>

  <script>
    let total = 0;
    const contador = document.getElementById('contador');

    document.getElementById('sumar').addEventListener('click', () => {
      total += 1;
      contador.textContent = total;
    });

    document.getElementById('log').addEventListener('click', () => {
      console.log('Mensaje normal', { total, fecha: new Date().toLocaleTimeString() });
      console.warn('Esto es un aviso');
    });

    console.log('La página de ejemplo se cargó correctamente.');
  </script>
</body>
</html>
`;
