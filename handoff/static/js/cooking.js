(() => {
  'use strict';

  const cartKey = 'syto-cart-v1';
  const timersKey = 'syto-timers-v1';
  const pickerKey = 'syto-picker-v1';
  const memory = new Map();
  const byId = id => document.getElementById(id);
  const book = Array.isArray(window.SYTO_RECIPES) ? window.SYTO_RECIPES : [];
  const recipes = new Map(book.map(recipe => [recipe.id, recipe]));
  const page = document.querySelector('[data-cooking-page]')?.dataset.cookingPage;
  const query = new URLSearchParams(location.search);
  const numberFormat = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 2});
  const quantity = n => numberFormat.format(n);
  const rubles = n => quantity(Math.round(n)) + ' ₽';
  const arrayOfIds = values => Array.isArray(values) ? values.filter(value => typeof value === 'string') : [];
  const portions = n => Math.min(8, Math.max(1, Math.round(Number(n) || 2)));
  const imagePath = recipe => 'static/images/' + encodeURIComponent(recipe.image);
  const recipeLink = id => 'recipe.html?id=' + encodeURIComponent(id);
  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? memory.get(key) ?? fallback; }
    catch { return memory.get(key) ?? fallback; }
  }
  function save(key, value) {
    memory.set(key, value);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Current page remains usable. */ }
  }
  function clone(templateId) {
    return byId(templateId).content.firstElementChild.cloneNode(true);
  }
  function amountOf(item, scale) {
    return quantity(Number(item.quantity) * scale) + ' ' + item.unit;
  }
  function formCriteria() {
    const stored = read(pickerKey, {});
    const ids = (param, field) => query.has(param) ? query.get(param).split(',').filter(Boolean) : arrayOfIds(stored[field]);
    return {products: ids('have', 'products'), excluded: ids('omit', 'excluded'), diet: ids('diet', 'diet')};
  }
  function readCart() {
    const state = read(cartKey, {});
    const entries = {};
    for (const [id, original] of Object.entries(state?.entries ?? {})) {
      const recipe = recipes.get(id);
      if (!recipe || !original) continue;
      const requested = new Set(arrayOfIds(original.ids));
      const ids = recipe.ingredients.filter(item => requested.has(item.id)).map(item => item.id);
      if (ids.length) entries[id] = {servings: portions(original.servings), ids};
    }
    return {entries, checked: arrayOfIds(state?.checked)};
  }
  function groupItems(cart) {
    const items = new Map();
    for (const [recipeId, entry] of Object.entries(cart.entries)) {
      const recipe = recipes.get(recipeId);
      if (!recipe) continue;
      const included = new Set(entry.ids);
      const scale = entry.servings / recipe.servings;
      for (const part of recipe.ingredients) {
        if (!included.has(part.id)) continue;
        const item = items.get(part.id) ?? {id: part.id, name: part.name, unit: part.unit, quantity: 0, cost: 0};
        item.quantity += Number(part.quantity) * scale;
        item.cost += Number(part.cost) * scale;
        items.set(part.id, item);
      }
    }
    return items;
  }
  function writeCart(cart) {
    const items = groupItems(cart);
    cart.checked = [...new Set(cart.checked)].filter(id => items.has(id));
    save(cartKey, cart);
    window.dispatchEvent(new Event('syto-cart-change'));
  }

  // Absolute deadlines keep a timer accurate after background throttling or navigation.
  const tickerButtons = new Map();
  let timerInterval = null;
  function clockText(seconds) {
    const n = Math.max(0, Math.ceil(seconds));
    return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  }
  function remaining(timer) {
    return timer.mode === 'run' ? Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000)) : timer.seconds;
  }
  function showBell(key, timer) {
    let host = document.querySelector('.cook-notices');
    if (!host) {
      host = document.createElement('section');
      host.className = 'cook-notices';
      host.setAttribute('aria-label', 'Таймеры готовки');
      document.body.append(host);
    }
    if ([...host.children].some(el => el.dataset.timerKey === key)) return;
    const article = document.createElement('div');
    article.className = 'cook-bell';
    article.dataset.timerKey = key;
    const message = document.createElement('strong');
    message.setAttribute('role', 'status');
    message.textContent = 'Таймер закончился';
    const link = document.createElement('a');
    link.href = recipeLink(timer.recipeId) + '#step-' + (timer.index + 1);
    link.textContent = timer.title;
    const close = document.createElement('button');
    close.className = 'bell-close';
    close.type = 'button';
    close.textContent = 'Закрыть';
    close.setAttribute('aria-label', 'Закрыть уведомление таймера');
    close.addEventListener('click', () => {
      const timers = read(timersKey, {});
      if (timers[key]) timers[key].acknowledged = true;
      save(timersKey, timers);
      const restoreFocus = article.contains(document.activeElement);
      article.remove();
      if (restoreFocus) (tickerButtons.get(key)?.button || document.querySelector('main a, main button'))?.focus();
    });
    article.append(message, link, close);
    host.append(article);
  }
  function syncTimers() {
    const timers = read(timersKey, {});
    let dirty = false;
    let running = false;
    for (const [key, timer] of Object.entries(timers)) {
      if (timer.mode === 'run' && remaining(timer) <= 0) {
        timer.mode = 'done';
        timer.seconds = 0;
        dirty = true;
      }
      if (timer.mode === 'run') running = true;
      if (timer.mode === 'done' && !timer.acknowledged) showBell(key, timer);
    }
    if (dirty) save(timersKey, timers);
    for (const el of document.querySelectorAll('.cook-bell')) {
      const timer = timers[el.dataset.timerKey];
      if (!timer || timer.mode !== 'done' || timer.acknowledged) el.remove();
    }
    for (const [key, ui] of tickerButtons) {
      const timer = timers[key];
      const mode = timer?.mode;
      const label = mode === 'run' ? 'Пауза' : mode === 'pause' ? 'Продолжить' : mode === 'done' ? 'Запустить снова' : 'Таймер на ' + ui.minutes + ' мин';
      if (ui.label.textContent !== label) {
        ui.label.textContent = label;
        ui.button.setAttribute('aria-label', label + ', шаг ' + ui.step);
      }
      ui.reset.hidden = !timer || mode === 'done';
      ui.value.hidden = !timer;
      if (timer) ui.value.textContent = mode === 'done' ? 'Время вышло' : clockText(remaining(timer));
    }
    if (running && !timerInterval) timerInterval = setInterval(syncTimers, 1000);
    if (!running && timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }
  function setupClock(row, recipe, step, index) {
    const minutes = Number(step.minutes);
    if (!(minutes > 0)) return;
    const key = recipe.id + '/' + index;
    const group = row.querySelector('.step-timer');
    group.hidden = false;
    const button = group.querySelector('.clock-trigger');
    const label = button.querySelector('span');
    const reset = group.querySelector('.clock-reset');
    const value = group.querySelector('.clock-value');
    tickerButtons.set(key, {button, label, reset, value, minutes, step: index + 1});
    reset.setAttribute('aria-label', 'Сбросить таймер шага ' + (index + 1));
    button.addEventListener('click', () => {
      const timers = read(timersKey, {});
      const current = timers[key];
      const init = {title: step.title, recipeId: recipe.id, index, acknowledged: false};
      if (current?.mode === 'run' && remaining(current) > 0) {
        timers[key] = {...init, mode: 'pause', seconds: remaining(current)};
      } else {
        const seconds = current?.mode === 'pause' ? current.seconds : minutes * 60;
        timers[key] = {...init, mode: 'run', endsAt: Date.now() + seconds * 1000};
      }
      save(timersKey, timers);
      syncTimers();
    });
    reset.addEventListener('click', () => {
      const timers = read(timersKey, {});
      delete timers[key];
      save(timersKey, timers);
      syncTimers();
      button.focus();
    });
  }

  function relatedRecipes(recipe, criteria) {
    const mainIngredients = new Map(recipe.ingredients.filter(part => !part.pantry).map(item => [item.id, item.name]));
    const excluded = new Set(criteria.excluded);
    const choices = [];
    for (const other of book) {
      if (other.id === recipe.id || other.family === recipe.family || other.ingredients.some(part => excluded.has(part.id))) continue;
      if (!criteria.diet.every(tag => other.tags.includes(tag))) continue;
      const overlap = other.ingredients.filter(part => mainIngredients.has(part.id));
      if (overlap.length) choices.push({other, overlap});
    }
    // Prefer different dishes, even in large families of seasonings and substitutions.
    choices.sort((a, b) => b.overlap.length - a.overlap.length || Number(a.other.isVariant) - Number(b.other.isVariant));
    const families = new Set();
    const list = byId('related-rows');
    for (const {other, overlap} of choices) {
      if (families.has(other.family)) continue;
      const card = clone('related-recipe-template');
      card.href = recipeLink(other.id);
      if (location.protocol === 'file:' && (criteria.products.length || criteria.excluded.length || criteria.diet.length)) {
        const params = new URLSearchParams({id: other.id, have: criteria.products.join(','), omit: criteria.excluded.join(','), diet: criteria.diet.join(',')});
        card.href = 'recipe.html?' + params;
      }
      card.querySelector('img').src = imagePath(other);
      card.querySelector('.related-name').textContent = other.name;
      card.querySelector('.related-time').textContent = 'Около ' + other.minutes + ' мин';
      card.querySelector('.related-common').textContent = 'В обоих блюдах — ' + overlap.map(item => item.name.toLocaleLowerCase('ru')).slice(0, 2).join(', ');
      list.append(card);
      families.add(other.family);
      if (families.size >= 3) break;
    }
    byId('related-recipes').hidden = !families.size;
  }

  let updateRecipeButton = () => {};
  function showRecipe() {
    const recipe = recipes.get(query.get('id'));
    if (!recipe) { byId('recipe-missing').hidden = false; document.title = 'Рецепт не найден — СытоМастер'; return; }
    const criteria = formCriteria();
    const signature = [...criteria.products].sort().join(',');
    const prefKey = 'syto-recipe-prefs/' + recipe.id;
    const prefs = read(prefKey, {});
    const available = new Set(criteria.products);
    const have = new Set(prefs.signature === signature && Array.isArray(prefs.have) ? prefs.have : recipe.ingredients.filter(part => part.pantry || available.has(part.id)).map(part => part.id));
    let servings = portions(prefs.servings || recipe.servings);
    const selector = byId('dish-portions');
    selector.value = String(servings);
    const savePrefs = () => save(prefKey, {signature, have: [...have], servings});
    byId('dish-name').textContent = recipe.name;
    document.title = recipe.name + ' — СытоМастер';
    byId('dish-description').textContent = recipe.description;
    byId('dish-time').textContent = '≈ ' + recipe.minutes + ' мин';
    byId('dish-price').textContent = '≈ ' + rubles(recipe.price);
    const photo = byId('dish-photo');
    photo.src = imagePath(recipe);
    photo.alt = recipe.isVariant ? 'Пример подачи: ' + recipe.imageAlt : recipe.name;
    const caption = byId('dish-caption');
    if (recipe.isVariant && recipe.imageCaption) { caption.textContent = recipe.imageCaption; caption.hidden = false; }
    byId('recipe-credit').textContent = recipe.source + '.';
    const missing = () => recipe.ingredients.filter(part => !have.has(part.id)).map(part => part.id);
    const addButton = byId('add-missing');
    function buttonState() {
      const ids = missing();
      const cart = readCart();
      const entry = cart.entries[recipe.id];
      const same = entry && entry.servings === servings && ids.length === entry.ids.length && ids.every(id => entry.ids.includes(id));
      addButton.disabled = Boolean(same || (!ids.length && !entry));
      addButton.textContent = same ? 'Добавлено в корзину' : !ids.length && !entry ? 'Всё есть дома' : entry ? 'Обновить корзину' : 'Добавить недостающее';
      byId('see-cart').hidden = !Object.keys(cart.entries).length;
    }
    updateRecipeButton = buttonState;
    const amountLabels = [];
    for (const part of recipe.ingredients) {
      const row = clone('kitchen-item-template');
      const checkbox = row.querySelector('input');
      checkbox.checked = have.has(part.id);
      checkbox.setAttribute('aria-label', 'Есть дома: ' + part.name);
      row.querySelector('.kitchen-name').textContent = part.name;
      const amount = row.querySelector('.kitchen-amount');
      amount.textContent = amountOf(part, servings / recipe.servings);
      amountLabels.push({part, amount});
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) have.add(part.id); else have.delete(part.id);
        savePrefs();
        byId('basket-feedback').textContent = '';
        buttonState();
      });
      byId('ingredient-rows').append(row);
    }
    selector.addEventListener('change', () => {
      servings = portions(selector.value);
      amountLabels.forEach(({part, amount}) => amount.textContent = amountOf(part, servings / recipe.servings));
      savePrefs();
      byId('basket-feedback').textContent = '';
      buttonState();
    });
    addButton.addEventListener('click', () => {
      const cart = readCart();
      const before = groupItems(cart);
      const ids = missing();
      if (ids.length) cart.entries[recipe.id] = {servings, ids};
      else delete cart.entries[recipe.id];
      const after = groupItems(cart);
      cart.checked = cart.checked.filter(id => after.has(id) && before.has(id) && before.get(id).quantity >= after.get(id).quantity);
      writeCart(cart);
      buttonState();
      byId('basket-feedback').textContent = ids.length ? 'Список покупок обновлён.' : 'Для этого блюда ничего покупать не нужно.';
      if (!byId('see-cart').hidden) byId('see-cart').focus();
    });
    for (const [index, step] of recipe.steps.entries()) {
      const row = clone('method-item-template');
      row.id = 'step-' + (index + 1);
      row.querySelector('.method-number').textContent = String(index + 1);
      row.querySelector('h3').textContent = step.title;
      row.querySelector('.method-text').textContent = step.text;
      setupClock(row, recipe, step, index);
      byId('method-rows').append(row);
    }
    relatedRecipes(recipe, criteria);
    byId('recipe-view').hidden = false;
    buttonState();
    if (location.hash.startsWith('#step-')) requestAnimationFrame(() => byId(location.hash.slice(1))?.scrollIntoView());
  }

  let lastRemoval = null;
  function restoreRemoval() {
    if (!lastRemoval) return;
    const {id, parents, wasChecked} = lastRemoval;
    const cart = readCart();
    for (const [recipeId, servings] of parents) {
      const entry = cart.entries[recipeId] ?? {servings, ids: []};
      if (!entry.ids.includes(id)) entry.ids.push(id);
      cart.entries[recipeId] = entry;
    }
    if (wasChecked) cart.checked.push(id);
    lastRemoval = null;
    writeCart(cart);
    byId('cart-undo').hidden = true;
    renderCart();
    document.querySelector('.shopping-item input[data-ingredient="' + CSS.escape(id) + '"]')?.focus();
  }
  function removeItem(id) {
    const cart = readCart();
    const parents = [];
    const visibleRows = [...document.querySelectorAll('.shopping-item')];
    const position = visibleRows.findIndex(row => row.querySelector('input')?.dataset.ingredient === id);
    for (const [recipeId, entry] of Object.entries(cart.entries)) {
      if (!entry.ids.includes(id)) continue;
      parents.push([recipeId, entry.servings]);
      entry.ids = entry.ids.filter(item => item !== id);
      if (!entry.ids.length) delete cart.entries[recipeId];
    }
    const itemName = groupItems(readCart()).get(id)?.name || 'Продукт';
    lastRemoval = {id, parents, wasChecked: cart.checked.includes(id)};
    writeCart(cart);
    byId('cart-undo').hidden = false;
    byId('undo-message').textContent = itemName + ' убрали из списка.';
    renderCart();
    const remainingRows = [...document.querySelectorAll('.shopping-remove')];
    (remainingRows[Math.min(Math.max(position, 0), remainingRows.length - 1)] || byId('undo-remove')).focus();
  }

  function renderCart() {
    const cart = readCart();
    const items = [...groupItems(cart).values()];
    byId('cart-empty').hidden = Boolean(items.length);
    byId('cart-filled').hidden = !items.length;
    const list = byId('shopping-rows');
    list.replaceChildren();
    const dishes = byId('cart-recipes');
    dishes.replaceChildren();
    if (!items.length) return;
    for (const [id, entry] of Object.entries(cart.entries)) {
      const a = document.createElement('a');
      const li = document.createElement('li');
      const count = document.createElement('span');
      a.href = recipeLink(id);
      a.textContent = recipes.get(id).name;
      count.textContent = entry.servings + ' ' + (entry.servings === 1 ? 'порция' : entry.servings < 5 ? 'порции' : 'порций');
      li.append(a, count);
      dishes.append(li);
    }
    const checked = new Set(cart.checked);
    const updateTotals = () => {
      const left = items.filter(item => !checked.has(item.id));
      byId('cart-total').textContent = left.length ? '≈ ' + rubles(left.reduce((sum, item) => sum + item.cost, 0)) : '0 ₽';
      byId('cart-progress').textContent = left.length ? 'Куплено ' + (items.length - left.length) + ' из ' + items.length : 'Все продукты куплены';
    };
    for (const item of items) {
      const row = clone('shopping-item-template');
      const check = row.querySelector('input');
      check.checked = checked.has(item.id);
      check.dataset.ingredient = item.id;
      check.setAttribute('aria-label', 'Куплено: ' + item.name);
      row.classList.toggle('is-bought', check.checked);
      row.querySelector('.shopping-name').textContent = item.name;
      row.querySelector('.shopping-quantity').textContent = quantity(item.quantity) + ' ' + item.unit;
      row.querySelector('.shopping-price').textContent = '≈ ' + rubles(item.cost);
      const remove = row.querySelector('.shopping-remove');
      remove.setAttribute('aria-label', 'Убрать из корзины: ' + item.name);
      remove.addEventListener('click', () => removeItem(item.id));
      check.addEventListener('change', () => {
        const latest = readCart();
        const selected = new Set(latest.checked);
        if (check.checked) { checked.add(item.id); selected.add(item.id); }
        else { checked.delete(item.id); selected.delete(item.id); }
        latest.checked = [...selected];
        writeCart(latest);
        row.classList.toggle('is-bought', check.checked);
        updateTotals();
      });
      list.append(row);
    }
    updateTotals();
  }
  function cartCount() {
    return groupItems(readCart()).size;
  }
  function reflectCount() {
    const n = cartCount();
    document.querySelectorAll('[data-cart-count]').forEach(el => { el.textContent = String(n); el.hidden = n === 0; });
  }
  if (page === 'recipe') showRecipe();
  if (page === 'cart') {
    byId('undo-remove').addEventListener('click', restoreRemoval);
    renderCart();
  }
  syncTimers();
  reflectCount();
  window.addEventListener('syto-cart-change', reflectCount);
  window.addEventListener('pageshow', () => {
    reflectCount();
    if (page === 'cart') renderCart();
    updateRecipeButton();
    syncTimers();
  });
  window.addEventListener('storage', event => {
    if (event.key === cartKey || event.key === null) {
      if (page === 'cart') renderCart();
      updateRecipeButton();
      reflectCount();
    }
    if (event.key === timersKey || event.key === null) syncTimers();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncTimers(); });
})();
