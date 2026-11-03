/**
 * source-map.ts — Relaciona lo que se ve en el visor con su posición en el código.
 *
 * Sirve para "Localizar en el código": al seleccionar texto en la vista previa,
 * se resalta en el editor el sector del código fuente que lo produce.
 *
 * Funciona en dos pasos:
 *
 *   1. ANOTAR (antes de renderizar)
 *      Se analiza el HTML con el parser de CodeMirror (@lezer/html) y, en una
 *      COPIA que solo va al iframe, se agrega a cada etiqueta de apertura el
 *      atributo `data-ehv-src="N"`, donde N es la posición del `<` en el código.
 *
 *        <p class="a">Hola</p>   →   <p data-ehv-src="0" class="a">Hola</p>
 *
 *      El editor y el archivo exportado NO se modifican.
 *
 *   2. LOCALIZAR (cuando el usuario selecciona texto en el visor)
 *      El runtime del iframe describe cada extremo de la selección
 *      (`SelectionEndpoint`): qué elemento anotado lo contiene, en qué "hueco"
 *      de texto está y qué texto se seleccionó. Con eso y el árbol sintáctico
 *      guardado en el paso 1, se busca el texto dentro del elemento.
 *      Si no se encuentra (p. ej. lo generó JavaScript), se usa el elemento entero.
 *
 * Qué es un "hueco" (gap): el texto directo de un elemento queda partido por sus
 * hijos. En `<p>Hola <b>mundo</b> fin</p>`, "Hola " es el hueco 0 y " fin" el
 * hueco 1. El DOM y el código fuente numeran los huecos igual, así que buscar
 * dentro del hueco correcto evita confundir textos repetidos.
 */

import { parser } from '@lezer/html';
import type { SyntaxNode, Tree } from '@lezer/common';
import type { SelectionEndpoint } from './runtime';

/** Atributo que se agrega a cada elemento en la copia que va al visor. */
export const SOURCE_ATTRIBUTE = 'data-ehv-src';

/** El código tal como se renderizó, junto con su árbol sintáctico. */
export interface SourceSnapshot {
  source: string;
  tree: Tree;
}

/** Rango del código fuente (posiciones de carácter, `from` incluido y `to` excluido). */
export interface SourceRange {
  from: number;
  to: number;
}

// =============================================================================
// 1. Anotar
// =============================================================================

/**
 * Devuelve una copia del HTML con `data-ehv-src` en cada etiqueta de apertura,
 * y la "instantánea" necesaria para localizar selecciones más tarde.
 */
export function annotateSource(source: string): { html: string; snapshot: SourceSnapshot } {
  const tree = parser.parse(source);

  // Puntos de inserción: justo después del nombre de cada etiqueta de apertura.
  const insertions: { at: number; elementStart: number }[] = [];
  tree.iterate({
    enter(ref) {
      if (ref.name !== 'TagName') return;
      const tag = ref.node.parent;
      const element = tag?.parent;
      if (tag && element?.name === 'Element' && (tag.name === 'OpenTag' || tag.name === 'SelfClosingTag')) {
        insertions.push({ at: ref.to, elementStart: element.from });
      }
    },
  });

  // Armar el texto de una sola pasada. Las posiciones guardadas son las del
  // código ORIGINAL, no las de la copia anotada.
  const parts: string[] = [];
  let last = 0;
  for (const { at, elementStart } of insertions) {
    parts.push(source.slice(last, at), ` ${SOURCE_ATTRIBUTE}="${elementStart}"`);
    last = at;
  }
  parts.push(source.slice(last));

  return { html: parts.join(''), snapshot: { source, tree } };
}

// =============================================================================
// 2. Localizar
// =============================================================================

/**
 * Convierte una selección del visor (sus dos extremos) en un rango del código.
 * Devuelve `null` si algún extremo no pudo ubicarse.
 */
export function locateSelection(
  snapshot: SourceSnapshot,
  start: SelectionEndpoint,
  end: SelectionEndpoint,
): SourceRange | null {
  const from = locateEndpoint(snapshot, start, 'start');
  const to = locateEndpoint(snapshot, end, 'end');
  if (from === null || to === null) return null;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** Posición en el código de un extremo de la selección. */
function locateEndpoint(snapshot: SourceSnapshot, endpoint: SelectionEndpoint, side: 'start' | 'end'): number | null {
  const element = findElement(snapshot.tree, endpoint.src);
  if (!element) return null;

  // El extremo cae en el borde de un elemento, no dentro de un texto.
  const elementEdge = endpoint.edge === 'start' ? element.from : element.to;

  // Ignorar espacios de los bordes del texto, ajustando la posición relativa.
  const leading = endpoint.text.length - endpoint.text.trimStart().length;
  const text = endpoint.text.trim();
  if (!text) return elementEdge;
  const before = endpoint.before + leading;

  // Buscar primero en el hueco exacto y, si no aparece, en todo el contenido del elemento.
  const regions = [endpoint.gap >= 0 ? gapRegion(element, endpoint.gap) : null, contentRegion(element)];
  for (const region of regions) {
    if (!region) continue;
    const match = findText(snapshot.source, region, text, before);
    if (match) return side === 'start' ? match.from : match.to;
  }
  return elementEdge;
}

/** Busca el nodo `Element` que empieza exactamente en `position`. */
function findElement(tree: Tree, position: number): SyntaxNode | null {
  let node: SyntaxNode | null = tree.resolve(position, 1);
  while (node) {
    if (node.name === 'Element' && node.from === position) return node;
    node = node.parent;
  }
  return null;
}

/** Contenido de un elemento: entre el final de `<tag ...>` y el inicio de `</tag>`. */
function contentRegion(element: SyntaxNode): SourceRange | null {
  const open = element.getChild('OpenTag');
  if (!open) return null; // elemento sin contenido, como <br> o <img>
  const close = element.getChild('CloseTag');
  return { from: open.to, to: close ? close.from : element.to };
}

/**
 * Región del hueco de texto número `gap` dentro de un elemento.
 * Los huecos se separan por elementos hijos y comentarios, igual que en el DOM.
 */
function gapRegion(element: SyntaxNode, gap: number): SourceRange | null {
  const content = contentRegion(element);
  if (!content) return null;

  let index = 0;
  let regionStart = content.from;
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'Element' && child.name !== 'Comment') continue;
    if (index === gap) return { from: regionStart, to: child.from };
    index += 1;
    regionStart = child.to;
  }
  return index === gap ? { from: regionStart, to: content.to } : null;
}

/**
 * Busca `text` dentro de `region` del código. Si aparece varias veces, elige la
 * coincidencia más cercana a la posición esperada (`before` caracteres desde el
 * inicio del texto en el DOM).
 */
function findText(source: string, region: SourceRange, text: string, before: number): SourceRange | null {
  const haystack = source.slice(region.from, region.to);
  const pattern = new RegExp(textToPattern(text), 'g');

  let best: SourceRange | null = null;
  let bestDistance = Infinity;
  for (const match of haystack.matchAll(pattern)) {
    const index = match.index ?? 0;
    const distance = Math.abs(index - before);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { from: region.from + index, to: region.from + index + match[0].length };
    }
    if (match[0].length === 0) break; // seguridad: nunca debería ocurrir
  }
  return best;
}

/**
 * Convierte el texto visible en una expresión regular que también reconoce
 * cómo puede estar escrito en el código:
 *   - cualquier secuencia de espacios/saltos de línea equivale a otra
 *   - &, <, >, " y el espacio duro pueden aparecer como entidades (&amp;, &lt;…)
 */
function textToPattern(text: string): string {
  const entityAlternatives: Record<string, string> = {
    '&': '(?:&|&amp;|&#0*38;|&#x0*26;)',
    '<': '(?:<|&lt;|&#0*60;)',
    '>': '(?:>|&gt;|&#0*62;)',
    '"': '(?:"|&quot;|&#0*34;)',
    ' ': '(?: |&nbsp;|&#0*160;)',
  };

  let pattern = '';
  let inWhitespace = false;
  for (const char of text) {
    // El espacio duro va antes del chequeo de espacios porque \s también lo incluye.
    const entity = entityAlternatives[char];
    if (entity) {
      pattern += entity;
      inWhitespace = false;
    } else if (/\s/.test(char)) {
      if (!inWhitespace) pattern += '\\s+';
      inWhitespace = true;
    } else {
      pattern += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      inWhitespace = false;
    }
  }
  return pattern;
}
