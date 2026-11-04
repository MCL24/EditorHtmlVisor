/**
 * doc-tabs.ts — Pestañas de documentos, encima del editor.
 *
 * Solo dibuja: recibe la lista de documentos y avisa qué hizo el usuario
 * (elegir, cerrar o crear). Qué pasa después lo decide main.ts.
 *
 * Cada pestaña muestra el nombre y, si hay cambios sin guardar, un punto (●).
 * Se cierra con la ×, con el botón central del ratón o con Supr cuando la pestaña tiene el foco.
 */

import type { OpenDocument } from '../documents';

export interface DocTabsCallbacks {
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

export class DocTabs {
  private readonly list: HTMLElement;

  constructor(container: HTMLElement, callbacks: DocTabsCallbacks) {
    this.list = document.createElement('div');
    this.list.className = 'doc-tabs__list';

    const newButton = document.createElement('button');
    newButton.type = 'button';
    newButton.className = 'doc-tabs__new';
    newButton.title = 'Documento nuevo';
    newButton.setAttribute('aria-label', 'Documento nuevo');
    newButton.textContent = '+';
    newButton.addEventListener('click', callbacks.onNew);

    container.append(this.list, newButton);

    // Un solo listener para todas las pestañas (se redibujan seguido).
    const idOf = (target: EventTarget | null) => (target as HTMLElement | null)?.closest<HTMLElement>('[data-id]')?.dataset.id;
    this.list.addEventListener('click', (event) => {
      const id = idOf(event.target);
      if (!id) return;
      if ((event.target as HTMLElement).closest('.doc-tab__close')) callbacks.onClose(id);
      else callbacks.onSelect(id);
    });
    this.list.addEventListener('auxclick', (event) => {
      const id = idOf(event.target);
      if (id && event.button === 1) callbacks.onClose(id); // botón central
    });
    this.list.addEventListener('keydown', (event) => {
      const id = idOf(event.target);
      if (id && event.key === 'Delete') callbacks.onClose(id);
    });
  }

  /** Vuelve a dibujar todas las pestañas. */
  render(docs: readonly OpenDocument[], activeId: string): void {
    this.list.replaceChildren(...docs.map((doc) => this.renderTab(doc, doc.id === activeId)));
    this.list.querySelector('.doc-tab--active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private renderTab(doc: OpenDocument, active: boolean): HTMLElement {
    const tab = document.createElement('div');
    tab.className = `doc-tab${active ? ' doc-tab--active' : ''}${doc.dirty ? ' doc-tab--dirty' : ''}`;
    tab.dataset.id = doc.id;

    const where = doc.handle ? 'vinculado a un archivo del disco' : 'solo en este navegador';
    const state = doc.dirty ? 'cambios sin guardar' : 'sin cambios';

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'doc-tab__name';
    name.textContent = doc.name;
    name.title = `${doc.name} · ${state} · ${where}`;
    if (active) name.setAttribute('aria-current', 'true');

    const dot = document.createElement('span');
    dot.className = 'doc-tab__dot';
    dot.setAttribute('aria-hidden', 'true');
    dot.textContent = '●';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'doc-tab__close';
    close.title = 'Cerrar';
    close.setAttribute('aria-label', `Cerrar ${doc.name}`);
    close.textContent = '×';

    tab.append(name, dot, close);
    return tab;
  }
}
