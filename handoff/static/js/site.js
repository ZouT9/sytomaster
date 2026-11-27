(() => {
  'use strict';
  const foods = Array.isArray(window.SYTO_RECIPES) ? window.SYTO_RECIPES : [];
  const byId = new Map(foods.map(recipe => [recipe.id, recipe]));
  const byElement = id => document.getElementById(id);
  const getPath = id => window.SytoSearch?.recipeURL?.(id) || 'recipe.html?id=' + encodeURIComponent(id);
  function item(name, text, className) {
    const el = document.createElement(name);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function template(id) {
    const source = byElement(id);
    return source?.content?.firstElementChild?.cloneNode(true);
  }
  function dishCard(recipe, eager = false) {
    const a = template('dish-card');
    a.href = getPath(recipe.id);
    a.dataset.recipe = recipe.id;
    const img = a.querySelector('[data-dish-image]');
    img.src = 'static/images/' + recipe.image;
    img.loading = eager ? 'eager' : 'lazy';
    a.querySelector('[data-dish-name]').textContent = recipe.name;
    a.querySelector('[data-dish-minutes]').textContent = '≈ ' + recipe.minutes + ' мин';
    a.querySelector('[data-dish-price]').textContent = '≈ ' + recipe.price + ' ₽/порц.';
    if (recipe.isVariant) {
      img.alt = recipe.imageCaption;
      a.querySelector('.dish-copy').append(item('small','Пример подачи','serving-note'));
    }
    return a;
  }
  function matchRow(recipe, reason) {
    const a = item('a',undefined,'match-item');
    a.href = getPath(recipe.id);
    const photo = item('img'); photo.src = 'static/images/' + recipe.image; photo.alt = recipe.isVariant ? recipe.imageCaption : '';
    const desc = item('div'); desc.append(item('strong',recipe.name));
    const meta = item('span', undefined, 'dish-meta');
    const time = item('span');
    time.append(window.SytoIcons.make('clock'), '≈ ' + recipe.minutes + ' мин');
    meta.append(time,item('span','≈ ' + recipe.price + ' ₽ за порцию'));
    desc.append(meta);
    if (reason) desc.append(item('span',reason,'dish-reason'));
    const arrow = window.SytoIcons.make('arrow-right', 'match-arrow');
    a.append(photo,desc,arrow); return a;
  }
  function statePanel(payload) {
    const panel = template('state-' + payload.state);
    if (!panel) return null;
    const title = panel.querySelector('[data-state-title]');
    if (payload.title) title.textContent = payload.title;
    const notice = panel.querySelector('[data-state-notice]');
    if (notice) {notice.textContent = payload.notice || '';notice.hidden = !payload.notice;}
    const deck = panel.querySelector('[data-state-groups]');
    let hasFamilyPhotos = false;
    for (const group of payload.groups || []) {
      const section = item('section');
      const rows = item('div',undefined,'match-list');
      for (const record of group.items || []) {
        const recipe = byId.get(record.id);
        if (recipe) {
          rows.append(matchRow(recipe,record.reason));
          if (recipe.isVariant) hasFamilyPhotos = true;
        }
      }
      if (!rows.childElementCount) continue;
      if (group.title && group.title !== title.textContent) section.append(item('h3',group.title));
      section.append(rows);deck.append(section);
    }
    if (hasFamilyPhotos) deck.append(item('small','На фото вариантов показана подача базового блюда.','serving-note'));
    const actions = panel.querySelector('[data-state-actions]');
    if (actions) {
      actions.classList.add('state-actions');
      for (const action of payload.actions || []) {
        const b = item('button',action.label,'plain-button'); b.type='button';
        b.dataset.pickerAction = action.action;actions.append(b);
      }
    }
    return panel;
  }
  function renderResults(payload) {
    const output = byElement('search-output');
    if (!output) return;
    const idle = payload.state === 'idle';
    byElement('discover').hidden = !idle;
    output.hidden = idle;
    output.replaceChildren();
    if (idle) {byElement('search-announcement').textContent = '';return;}
    const panel = statePanel(payload);
    if (!panel) return;
    output.append(panel);
    byElement('search-announcement').textContent = [payload.title,payload.notice].filter(Boolean).join('. ');
  }
  function diverseOrder(list) {
    const buckets = new Map();
    for (const recipe of list) {
      const key = recipe.image || recipe.family;
      if (!buckets.has(key)) buckets.set(key,[]);
      buckets.get(key).push(recipe);
    }
    const result=[];
    for (let i=0;result.length<list.length;i++) for(const bucket of buckets.values()) if(bucket[i]) result.push(bucket[i]);
    return result;
  }
  function initDiscover(menu) {
    const heading = byElement('menu-title');
    const controls = document.querySelector('.menu-controls');
    const lastThemeKey = 'syto-last-discovery-theme';
    const themes = [
      { id:'quick', title:heading.textContent.trim(), ids:['rice','pasta'] },
      { id:'budget', title:'До 70 ₽ за порцию', ids:['soup','omelet'] },
      { id:'vegetables', title:'Блюда с овощами', ids:['beans','couscous'] },
      { id:'mushrooms', title:'С грибами', ids:['buckwheat','potatoes'] }
    ].map(theme => ({ ...theme, recipes:theme.ids.map(id => byId.get(id)) }))
      .filter(theme => theme.recipes.every(recipe => recipe?.image) && theme.recipes[0].image !== theme.recipes[1].image);
    if (!themes.length) return;

    let lastTheme;
    try { lastTheme = sessionStorage.getItem(lastThemeKey); } catch (_) {}
    const candidates = themes.filter(theme => theme.id !== lastTheme);
    const initial = candidates[Math.floor(Math.random() * candidates.length)] || themes[0];
    let active = themes.indexOf(initial);

    function showTheme(announce, direction) {
      const theme = themes[active];
      const title = item('span',theme.title);
      const cards = theme.recipes.map(recipe => dishCard(recipe, true));
      if (direction) {
        for (const element of [title, ...cards]) element.dataset.pairEntrance = direction;
      }
      heading.replaceChildren(title);
      menu.replaceChildren(...cards);
      if (announce) {
        const names = theme.recipes.map(recipe => recipe.name).join(', ');
        byElement('pair-status').textContent = theme.title + '. ' + names + '.';
      }
      try { sessionStorage.setItem(lastThemeKey,theme.id); } catch (_) {}
    }

    controls.hidden = themes.length < 2;
    for (const button of controls.querySelectorAll('button')) {
      button.addEventListener('click', event => {
        const next = button.hasAttribute('data-pair-next');
        active = (active + (next ? 1 : -1) + themes.length) % themes.length;
        const direction = event.detail > 0 ? (next ? 'next' : 'previous') : undefined;
        showTheme(true, direction);
      });
    }
    showTheme(false);
  }
  function initHome() {
    const menu = byElement('menu-pair');
    if (!menu) return;
    initDiscover(menu);
    const catalog = byElement('catalog-list');
    const prioritized = ['omelet','buckwheat','soup','beans','potatoes','couscous','rice','pasta'];
    const ordered = [...prioritized.map(id=>byId.get(id)).filter(Boolean),...diverseOrder(foods.filter(r=>!prioritized.includes(r.id)))];
    let limit=8;
    const q = byElement('catalog-query'), more=byElement('show-more');
    const normalize = s=>s.toLocaleLowerCase('ru').replaceAll('ё','е').trim();
    function renderCatalog(append=false) {
      const words=normalize(q.value).split(/\s+/).filter(Boolean);
      const list=words.length?ordered.filter(r=>words.every(word=>normalize(r.name).includes(word))):ordered;
      if (!append) catalog.replaceChildren();
      const from=catalog.childElementCount;
      const cards=list.slice(from,limit).map(r=>dishCard(r));
      catalog.append(...cards); more.hidden=limit>=list.length;byElement('catalog-message').hidden=!!list.length;
      byElement('catalog-count').textContent=list.length?'Показано '+Math.min(limit,list.length)+' из '+list.length:'';
      if (append && cards.length) cards[0].focus({preventScroll:true});
    }
    q.addEventListener('input',()=>{limit=8;renderCatalog();});
    more.addEventListener('click',()=>{limit+=8;renderCatalog(true);});
    if (foods.length) renderCatalog();
    document.addEventListener('click', event=>{
      const link = event.target.closest('a[data-recipe]');
      if (link) link.href = getPath(link.dataset.recipe);
    },true);
  }
  function initStates() {
    const box=byElement('state-gallery');
    if(!box) return;
    const examples=[
      {state:'empty',title:'Какие продукты есть дома?',notice:'Добавьте хотя бы один продукт, чтобы получить варианты.'},
      {state:'loading',title:'Подбираем блюда',notice:'Проверяем продукты и ограничения.'},
      {state:'result',title:'Из ваших продуктов',groups:[{title:'Можно готовить',items:[{id:'rice',reason:'Весь состав есть в списке.'}]}]},
      {state:'partial',title:'С докупкой',groups:[{items:[{id:'pasta',reason:'Понадобится сыр.'}]}]},
      {state:'empty',title:'Совпадений нет',notice:'Попробуйте выбрать другой бюджет или время. Строгие ограничения сохраняются.'},
      {state:'error',title:'Подбор недоступен',notice:'Введённые условия сохранены. Можно повторить поиск.'}
    ];
    for(const test of examples) {
      const frame=item('div',undefined,'specimen');const panel=statePanel(test);
      if(panel) {frame.append(panel);box.append(frame);}
    }
  }
  window.Syto = Object.assign(window.Syto || {},{renderResults,dishCard});
  initHome();initStates();
})();
