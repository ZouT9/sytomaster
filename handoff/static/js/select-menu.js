(function () {
  'use strict';

  let openMenu;

  function mount(root) {
    const select = root.querySelector('select');
    const label = select?.labels[0];
    if (!label || !select.options.length) return;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = `${select.id}-trigger`;
    trigger.className = 'select-menu__trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = '<span class="select-menu__value"></span><svg class="icon select-menu__chevron" aria-hidden="true"><use href="#i-chevron-down"></use></svg>';
    const value = trigger.firstElementChild;
    value.id = `${select.id}-value`;
    trigger.setAttribute('aria-labelledby', `${label.id} ${value.id}`);

    const list = document.createElement('ul');
    list.className = 'select-menu__list';
    list.id = `${select.id}-listbox`;
    list.hidden = true;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-labelledby', label.id);
    trigger.setAttribute('aria-controls', list.id);

    const items = Array.from(select.options, (option, index) => {
      const item = document.createElement('li');
      item.className = 'select-menu__option';
      item.id = `${list.id}-${index}`;
      item.setAttribute('role', 'option');
      item.innerHTML = '<span></span><svg class="icon select-menu__check" aria-hidden="true"><use href="#i-check"></use></svg>';
      item.firstElementChild.textContent = option.label;
      item.addEventListener('click', () => commit(index));
      list.append(item);
      return item;
    });

    let active = 0;
    let search = '';
    let typedAt = 0;

    function sync() {
      value.textContent = select.selectedOptions[0]?.label || '';
      items.forEach((item, index) => item.setAttribute('aria-selected', String(index === select.selectedIndex)));
    }

    function fit() {
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop || 0;
      const height = viewport?.height || window.innerHeight;
      const rect = trigger.getBoundingClientRect();
      const above = rect.top - top;
      const below = top + height - rect.bottom;
      const flip = below < Math.min(list.scrollHeight + 16, 232) && above > below;
      root.classList.toggle('select-menu--above', flip);
      list.style.setProperty('--menu-room', `${Math.max(1, (flip ? above : below) - 16)}px`);
    }

    function highlight(index) {
      items[active].removeAttribute('data-active');
      active = Math.min(items.length - 1, Math.max(0, index));
      const option = items[active];
      option.setAttribute('data-active', '');
      trigger.setAttribute('aria-activedescendant', option.id);
      const optionRect = option.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      if (optionRect.top < listRect.top) list.scrollTop += optionRect.top - listRect.top;
      if (optionRect.bottom > listRect.bottom) list.scrollTop += optionRect.bottom - listRect.bottom;
    }

    function close() {
      if (list.hidden) return;
      list.hidden = true;
      root.classList.remove('select-menu--open');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
      search = '';
      openMenu = undefined;
    }

    function open(index = Math.max(select.selectedIndex, 0)) {
      if (openMenu && openMenu.root !== root) openMenu.close();
      openMenu = {root, close, fit};
      list.hidden = false;
      root.classList.add('select-menu--open');
      trigger.setAttribute('aria-expanded', 'true');
      fit();
      highlight(index);
    }

    function commit(index) {
      close();
      if (index === select.selectedIndex) return;
      select.selectedIndex = index;
      select.dispatchEvent(new Event('input', {bubbles: true}));
      select.dispatchEvent(new Event('change', {bubbles: true}));
    }

    function typeahead(key) {
      const now = performance.now();
      const letter = key.toLocaleLowerCase('ru');
      search = now - typedAt < 600 && search !== letter ? search + letter : letter;
      typedAt = now;
      const start = search.length === 1 ? active + 1 : active;
      for (let offset = 0; offset < items.length; offset++) {
        const index = (start + offset) % items.length;
        if (select.options[index].label.toLocaleLowerCase('ru').startsWith(search)) {
          highlight(index);
          break;
        }
      }
    }

    trigger.addEventListener('click', () => {
      trigger.focus({preventScroll: true});
      if (list.hidden) open();
      else close();
    });
    trigger.addEventListener('blur', close);
    list.addEventListener('mousedown', event => {
      if (event.target.closest('.select-menu__option')) event.preventDefault();
    });
    trigger.addEventListener('keydown', event => {
      const {key} = event;
      const expanded = !list.hidden;
      if (key === 'Tab') {
        if (expanded) commit(active);
        return;
      }
      if (key === 'Escape' && expanded) close();
      else if (key === 'ArrowDown' || key === 'ArrowUp') {
        const direction = key === 'ArrowDown' ? 1 : -1;
        if (expanded) highlight(active + direction);
        else open();
      } else if (key === 'Home' || key === 'End') {
        const edge = key === 'Home' ? 0 : items.length - 1;
        if (expanded) highlight(edge);
        else open(edge);
      } else if (key === 'Enter' || key === ' ') {
        if (expanded) commit(active);
        else open();
      } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (!expanded) open();
        typeahead(key);
      } else return;
      event.preventDefault();
    });

    select.addEventListener('change', sync);
    select.form?.addEventListener('reset', () => queueMicrotask(sync));
    window.addEventListener('pageshow', sync);
    root.append(trigger, list);
    label.htmlFor = trigger.id;
    select.hidden = true;
    sync();
  }

  function initialize() {
    const roots = document.querySelectorAll('.select-menu');
    if (!roots.length) return;
    roots.forEach(mount);
    document.addEventListener('pointerdown', event => {
      if (openMenu && !openMenu.root.contains(event.target)) openMenu.close();
    });
    const fitOpen = () => openMenu?.fit();
    window.addEventListener('resize', fitOpen);
    window.addEventListener('scroll', fitOpen, {passive: true});
    window.visualViewport?.addEventListener('resize', fitOpen);
    window.visualViewport?.addEventListener('scroll', fitOpen);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})();
