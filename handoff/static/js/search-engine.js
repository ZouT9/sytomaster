(function (global) {
  'use strict';

  const storageKey = 'syto-picker-v1';
  const availableDiets = ['vegan', 'vegetarian', 'dairy-free', 'egg-free', 'gluten-free', 'halal'];
  const defaults = {products: [], excluded: [], diet: [], time: 30, budget: 300, mode: 'fast', relax: false, submitted: false};
  const unique = values => [...new Set(Array.isArray(values) ? values.filter(value => typeof value === 'string') : [])];
  const normalize = value => String(value).toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  let inMemory;

  function clean(value = {}) {
    const validLimit = (n, options, fallback) => options.includes(n) ? n : fallback;
    return {
      products: unique(value.products), excluded: unique(value.excluded),
      diet: unique(value.diet).filter(tag => availableDiets.includes(tag)),
      time: validLimit(value.time, [0, 15, 20, 25, 30, 45, 60], 30),
      budget: validLimit(value.budget, [0, 50, 100, 150, 200, 300, 500], 300),
      mode: ['fast', 'cheap', 'hearty'].includes(value.mode) ? value.mode : 'fast',
      relax: value.relax === true, submitted: value.submitted === true
    };
  }
  function readSettings() {
    try {
      const saved = JSON.parse(global.localStorage.getItem(storageKey));
      if (saved && typeof saved === 'object') return clean(saved);
    } catch (_) { /* A browser may deny file storage or have an older value. */ }
    return clean(inMemory || defaults);
  }
  function saveSettings(settings) {
    inMemory = clean(settings);
    try { global.localStorage.setItem(storageKey, JSON.stringify(inMemory)); } catch (_) { /* The current page still works. */ }
    return inMemory;
  }
  function dictionary(recipes) {
    const byId = new Map();
    for (const recipe of recipes) {
      for (const ingredient of recipe.ingredients) {
        let item = byId.get(ingredient.id);
        if (!item) {
          item = {id: ingredient.id, name: ingredient.name, keys: new Set(), frequency: 0};
          byId.set(item.id, item);
        }
        const words = [ingredient.name, ...(ingredient.aliases || [])];
        for (const word of words) item.keys.add(normalize(word));
        item.frequency++;
      }
    }
    return byId;
  }
  function findProducts(ingredients, query, omit = []) {
    const needle = normalize(query);
    const pool = [...ingredients.values()].filter(item => !omit.includes(item.id));
    if (!needle) {
      const common = ['рис','макароны','томаты','курица','нут','картофель','яйца','сыр'];
      const rank = item => common.findIndex(key => item.keys.has(key));
      return pool.sort((a,b) => (rank(a) < 0 ? Infinity : rank(a)) - (rank(b) < 0 ? Infinity : rank(b)) || b.frequency - a.frequency || a.name.localeCompare(b.name,'ru')).slice(0,8);
    }
    const score = item => {
      if (item.keys.has(needle)) return 0;
      if ([...item.keys].some(key => key.startsWith(needle))) return 1;
      if ([...item.keys].some(key => key.includes(needle))) return 2;
      return 3;
    };
    return pool.map(item => ({item, score:score(item)})).filter(value => value.score < 3)
      .sort((a,b) => a.score - b.score || b.item.frequency - a.item.frequency || a.item.name.localeCompare(b.item.name,'ru'))
      .slice(0,8).map(value=>value.item);
  }
  const quantity = (n, one, few, many) => n % 10 === 1 && n % 100 !== 11 ? one :
    (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);
  const listNames = items => items.map(item=>item.name.toLocaleLowerCase('ru')).join(', ');
  function assess(recipes, settings) {
    const selected = new Set(settings.products), excluded = new Set(settings.excluded);
    const exact = [], shopping = [], outside = [];
    for (const recipe of recipes) {
      if (settings.diet.some(tag => !recipe.tags?.includes(tag))) continue;
      if (recipe.ingredients.some(item => excluded.has(item.id))) continue;
      const owned = recipe.ingredients.filter(item => selected.has(item.id) && !item.pantry);
      const missing = recipe.ingredients.filter(item => !item.pantry && !selected.has(item.id));
      // Merely owning a common seasoning does not make every recipe a match.
      if (!owned.length && (missing.length || !recipe.ingredients.some(item=>selected.has(item.id)))) continue;
      const extraTime = settings.time ? Math.max(0,recipe.minutes-settings.time) : 0;
      const extraMoney = settings.budget ? Math.max(0,recipe.price-settings.budget) : 0;
      const row = {recipe,owned,missing,extraTime,extraMoney};
      if (extraTime || extraMoney) outside.push(row);
      else if (missing.length) shopping.push(row);
      else exact.push(row);
    }
    function rank(row) { return settings.mode === 'hearty' ? -row.recipe.hearty : settings.mode === 'cheap' ? row.recipe.price : row.recipe.minutes; }
    const compare = (a,b) => rank(a)-rank(b) || a.missing.length-b.missing.length || b.owned.length-a.owned.length || a.recipe.name.localeCompare(b.recipe.name,'ru');
    exact.sort(compare); shopping.sort(compare);
    // Respect time first. The brief permits a budget adjustment before a time adjustment.
    outside.sort((a,b) => Number(a.extraTime>0)-Number(b.extraTime>0) ||
      a.extraTime-b.extraTime || a.extraMoney-b.extraMoney || compare(a,b));
    return {exact,shopping,outside};
  }
  function diverse(rows, limit) {
    if (rows.length <= limit) return rows;
    const chosen = [], rest = [], families = new Set();
    for (const row of rows) {
      const family = row.recipe.family || row.recipe.id;
      if (families.has(family)) rest.push(row);
      else { families.add(family); chosen.push(row); }
    }
    const set = new Set([...chosen, ...rest].slice(0,limit));
    return rows.filter(row => set.has(row));
  }
  function reason(row) {
    const parts = [];
    if (row.extraTime) parts.push('Дольше на ' + row.extraTime + ' ' + quantity(row.extraTime,'минуту','минуты','минут'));
    if (row.extraMoney) parts.push('Дороже на ' + row.extraMoney + ' ₽ за порцию');
    if (row.missing.length) parts.push('Докупить: ' + listNames(row.missing));
    else parts.push('Все продукты есть');
    return parts.join('. ');
  }
  const offerRelax = {action:'relax',label:'Посмотреть варианты за пределами лимитов'};
  const edit = {action:'edit',label:'Изменить продукты'};
  function buildResult(assessed, settings, ingredients, selectedRows, modelNotice) {
    const groups = [];
    let count = 0;
    function append(title, candidates, limit) {
      const selected = diverse(candidates,Math.min(limit,5-count));
      if (!selected.length) return;
      groups.push({title,items:selected.map(row=>({id:row.recipe.id,reason:reason(row)}))});
      count+=selected.length;
    }
    const relaxed = settings.relax && assessed.outside.length > 0;
    append('Можно готовить',assessed.exact,relaxed ? 2 : 5);
    if (relaxed) append('С изменением условий',selectedRows || assessed.outside,Math.max(1,5-count));
    append('С докупкой',(!relaxed && selectedRows) || assessed.shopping,5-count);
    const picked = settings.products.map(id=>ingredients.get(id)).filter(Boolean);
    const parts = picked.length ? ['В подборе '+listNames(picked.slice(0,3))+(picked.length>3?' и другие продукты':'')+'.'] : [];
    if (count) {
      const conditions = [];
      if (settings.time) conditions.push('до '+settings.time+' минут');
      if (settings.budget) conditions.push('до '+settings.budget+' ₽ за порцию');
      if (conditions.length) parts.push((relaxed?'Исходные условия: ':'Условия: ')+conditions.join(', ')+'.');
      if (modelNotice) parts.push(modelNotice);
      return {state:assessed.exact.length&&!relaxed?'result':'partial',
        title:relaxed?'Если изменить условия':assessed.exact.length?'Из ваших продуктов':'Можно приготовить с докупкой',
        notice:parts.join(' '),groups,
        actions:!relaxed && assessed.outside.length && !assessed.exact.length ? [offerRelax] : []};
    }
    const hasOutside = assessed.outside.length>0;
    const halal = settings.diet.includes('halal');
    return {state:'empty',title:'Подходящих блюд пока нет',groups:[],
      notice:halal?'В каталоге пока нет рецептов с подтверждением халяль.':
        hasOutside?'С выбранными продуктами есть блюда, которым нужно больше времени или денег.':
        'Попробуйте добавить другие продукты или пересмотреть ограничения питания.',
      actions:hasOutside?[offerRelax,edit]:[edit]};
  }
  function recipeURL(id, path='recipe.html') {
    const url = new URL(path,global.location.href);
    url.searchParams.set('id',id);
    if (global.location.protocol==='file:') {
      const saved = readSettings();
      for (const [param,key] of [['have','products'],['omit','excluded'],['diet','diet']]) {
        if (saved[key].length) url.searchParams.set(param,saved[key].join(','));
      }
    }
    return url.href;
  }
  const api = {clean,readSettings,saveSettings,dictionary,findProducts,normalize,assess,buildResult,diverse,reason,recipeURL,defaults};
  global.SytoSearch = api;
  if (typeof module === 'object' && module.exports) module.exports=api;
})(typeof window === 'object' ? window : globalThis);
