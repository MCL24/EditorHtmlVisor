/**
 * theme.ts — Tema claro/oscuro de toda la app.
 *
 * Reglas:
 *   - Si el usuario nunca eligió un tema, se sigue `prefers-color-scheme`
 *     del sistema, incluso si cambia mientras la app está abierta.
 *   - Si el usuario alterna el tema, su elección se guarda y tiene prioridad.
 *
 * El tema se aplica con el atributo `data-theme` en <html>; las variables CSS
 * de cada tema están en styles/base.css. El editor recibe el cambio por `onApply`.
 */

import type { ThemeName } from '../settings';

const systemQuery = window.matchMedia('(prefers-color-scheme: dark)');

export class ThemeController {
  /** Elección explícita del usuario; `null` = seguir al sistema. */
  private chosen: ThemeName | null;

  constructor(
    saved: ThemeName | null,
    private readonly onApply: (theme: ThemeName) => void,
    private readonly onChoose: (theme: ThemeName) => void,
  ) {
    this.chosen = saved;
    systemQuery.addEventListener('change', () => {
      if (this.chosen === null) this.apply();
    });
    this.apply();
  }

  /** Tema que se está mostrando ahora. */
  get current(): ThemeName {
    return this.chosen ?? (systemQuery.matches ? 'dark' : 'light');
  }

  /** Alterna entre claro y oscuro y guarda la elección. */
  toggle(): void {
    this.chosen = this.current === 'dark' ? 'light' : 'dark';
    this.apply();
    this.onChoose(this.chosen);
  }

  private apply(): void {
    const theme = this.current;
    document.documentElement.dataset.theme = theme;
    // Indica al navegador el esquema para controles nativos (scrollbars, inputs, <select>).
    document.documentElement.style.colorScheme = theme;
    this.onApply(theme);
  }
}
