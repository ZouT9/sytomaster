(function () {
  'use strict';
  const S = window.SytoSearch;
  window.Syto = window.Syto || {};
  window.Syto.getSelectedIds = () => S.readSettings().products.slice();
  const idle = {state:'idle',title:'Ужин до 30 минут',notice:'',groups:[],actions:[]};

  function init() {
    const form = document.getElementById('recipe-finder');
    if (!form || !S || form.dataset.ready) return;
    form.dataset.ready='true';
    const submit = form.querySelector('#find-recipes');
    const reset = form.querySelector('.finder-reset');
    const time = form.querySelector('#finder-time');
    const budget = form.querySelector('#finder-budget');
    const buttonText = submit.querySelector('.finder-button-text');
    const constraintCount = form.querySelector('.finder-constraint-count');
    const diets = Array.from(form.querySelectorAll('[name=diet]'));
    const fields = [];
    let settings = S.readSettings(), catalog = [], ingredients = new Map();
    let activeRequest, requestId = 0, busy = false;
    function refreshData() {
      catalog = Array.isArray(window.SYTO_RECIPES) ? window.SYTO_RECIPES : [];
      ingredients = S.dictionary(catalog);
    }
    function show(payload) {
      if (typeof window.Syto?.renderResults === 'function') window.Syto.renderResults(payload);
      else window.dispatchEvent(new CustomEvent('syto:results',{detail:payload}));
    }
    function focusResult() {
      const heading = document.querySelector('#search-output [data-state-title]');
      if (heading) {
        heading.focus({preventScroll:true});
        const rect = heading.getBoundingClientRect();
        if (rect.top<0 || rect.top>innerHeight*.8) heading.scrollIntoView({block:'start'});
      }
    }
    function syncControls() {
      time.value=String(settings.time); budget.value=String(settings.budget);
      form.querySelectorAll('[name=mode]').forEach(el=>{el.checked=el.value===settings.mode;});
      diets.forEach(el=>{el.checked=settings.diet.includes(el.value);});
      const n=settings.excluded.length+settings.diet.length;
      constraintCount.textContent=n?' ('+n+')':'';
      submit.disabled=busy || !settings.products.length;
      submit.setAttribute('aria-busy',String(busy));
      buttonText.textContent=busy?'Подбираем…':'Подобрать';
      reset.hidden=!settings.products.length && !settings.excluded.length && !settings.diet.length &&
        settings.time===S.defaults.time && settings.budget===S.defaults.budget && settings.mode===S.defaults.mode;
      fields.forEach(field=>field.renderChosen());
    }
    function cancelRequest() {
      requestId++;
      if (activeRequest) activeRequest.abort();
      activeRequest=null; busy=false;
    }
    function changed() {
      const previouslySubmitted=settings.submitted || busy;
      cancelRequest();settings.relax=false;settings.submitted=false;
      S.saveSettings(settings);syncControls();
      if (previouslySubmitted) show(idle);
    }
    function setUpField(group) {
      const type=group.dataset.ingredientField;
      const otherType=type==='products'?'excluded':'products';
      const entry=group.querySelector('.ingredient-entry');
      const input=group.querySelector('input[role=combobox]');
      const initialPlaceholder=input.placeholder;
      const popover=group.querySelector('.ingredient-popover');
      const suggestions=group.querySelector('.ingredient-suggestions');
      const chosen=group.querySelector('.chosen-products');
      const feedback=group.querySelector('.finder-feedback');
      const chips=new Map();
      let choices=[],active=-1,opened=false;
      function say(message, brief=false) {
        feedback.textContent=message;
        feedback.classList.toggle('finder-sr',brief);
      }
      function close() {
        opened=false;active=-1;input.setAttribute('aria-expanded','false');
        input.removeAttribute('aria-activedescendant');popover.hidden=true;
      }
      function placeMenu() {
        if (!opened) return;
        const surface=entry.getBoundingClientRect();
        const viewport=window.visualViewport;
        const top=viewport?.offsetTop ?? 0;
        const bottom=top+(viewport?.height ?? window.innerHeight);
        const margin=16;
        const roomBelow=bottom-surface.bottom-margin;
        const roomAbove=surface.top-top-margin;
        const headerHeight=popover.offsetHeight-suggestions.offsetHeight;
        const comfortableHeight=Math.min(180,suggestions.scrollHeight+headerHeight);
        const above=roomBelow<comfortableHeight && roomAbove>roomBelow;
        popover.toggleAttribute('data-above',above);
        suggestions.style.setProperty('--options-space',Math.max(48,(above?roomAbove:roomBelow)-headerHeight)+'px');
      }
      function mark(index) {
        active=index;
        const items=suggestions.querySelectorAll('[role=option]');
        items.forEach((el,i)=>el.setAttribute('aria-selected',String(i===active)));
        if (items[index]) {
          input.setAttribute('aria-activedescendant',items[index].id);
          const option=items[index];
          if (option.offsetTop<suggestions.scrollTop) suggestions.scrollTop=option.offsetTop;
          else if (option.offsetTop+option.offsetHeight>suggestions.scrollTop+suggestions.clientHeight)
            suggestions.scrollTop=option.offsetTop+option.offsetHeight-suggestions.clientHeight;
        } else input.removeAttribute('aria-activedescendant');
      }
      function open() {
        const previous=opened?choices[active]?.id:null;
        choices=S.findProducts(ingredients,input.value,settings[type]);
        suggestions.replaceChildren(); active=-1;
        for (const [n,item] of choices.entries()) {
          const li=document.createElement('li');
          li.id=input.id+'-option-'+n;li.setAttribute('role','option');li.setAttribute('aria-selected','false');
          li.dataset.id=item.id;li.textContent=item.name;suggestions.append(li);
        }
        if (!choices.length) {
          close();
          say(input.value.trim()?'Такого продукта в списке нет. Попробуйте другое название.':'');
          return;
        }
        say('');opened=true;popover.hidden=false;input.setAttribute('aria-expanded','true');
        placeMenu();
        mark(previous?choices.findIndex(item=>item.id===previous):-1);
      }
      function choose(item) {
        if (!item) return;
        if (settings[otherType].includes(item.id)) {
          say(type==='products'?'Этот продукт уже исключён. Снимите исключение, чтобы добавить его.':'Этот продукт уже есть в вашем списке. Уберите его, чтобы исключить.');
          close();return;
        }
        if (!settings[type].includes(item.id)) {
          settings[type].push(item.id);
          changed();
          chosen.scrollTop=chosen.scrollHeight;
          say((type==='products'?'Добавлено: ':'Исключено: ')+item.name,true);
        }
        input.value='';input.focus({preventScroll:true});close();
      }
      function commit() {
        if (!input.value.trim() && active<0) {open();return;}
        const candidates=S.findProducts(ingredients,input.value,settings[type]);
        const exact=candidates.find(item=>item.keys.has(S.normalize(input.value)));
        const selected=opened&&active>=0?choices[active]:exact || (candidates.length===1?candidates[0]:null);
        if (selected) choose(selected);
        else {
          input.focus();open();
          if (candidates.length) say('Выберите продукт из списка.');
        }
      }
      input.addEventListener('input',event=>{if (!event.isComposing) open();});
      input.addEventListener('compositionend',open);
      input.addEventListener('click',()=>{if (!opened) open();});
      input.addEventListener('blur',event=>{if (event.relatedTarget) close();});
      input.addEventListener('keydown',event=>{
        if (event.isComposing) return;
        if (event.key==='ArrowDown' || event.key==='ArrowUp') {
          event.preventDefault();if (!opened) open();
          if (choices.length) mark(event.key==='ArrowDown'?(active+1)%choices.length:(active<1?choices.length-1:active-1));
        } else if (event.key==='Escape' && opened) {event.preventDefault();event.stopPropagation();close();}
        else if (event.key==='Enter') {event.preventDefault();commit();}
        else if (event.key==='Tab') close();
      });
      suggestions.addEventListener('mousedown',event=>{
        if (event.target.closest('[role=option]')) event.preventDefault();
      });
      suggestions.addEventListener('click',e=>{
        const option=e.target.closest('[data-id]');
        if (option) choose(ingredients.get(option.dataset.id));
      });
      window.addEventListener('resize',placeMenu);
      window.addEventListener('scroll',placeMenu,{passive:true});
      window.visualViewport?.addEventListener('resize',placeMenu);
      window.visualViewport?.addEventListener('scroll',placeMenu,{passive:true});
      return {close,contains:target=>group.contains(target),renderChosen() {
        const selected=new Set(settings[type]);
        for (const [id,chip] of chips) {
          if (selected.has(id)) continue;
          chip.remove();
          chips.delete(id);
        }
        for (const id of selected) {
          const item=ingredients.get(id);
          if (!item || chips.has(id)) continue;
          const chip=document.createElement('li');
          const label=document.createElement('span');
          const remove=document.createElement('button');
          chip.className='ingredient-chip';
          label.textContent=item.name;
          remove.type='button';
          remove.className='ingredient-remove';
          remove.append(window.SytoIcons.make('x'));
          remove.setAttribute('aria-label',(type==='products'?'Убрать продукт ':'Снять исключение ')+item.name);
          remove.addEventListener('click',()=>{
            const neighbor=chip.nextElementSibling || chip.previousElementSibling;
            settings[type]=settings[type].filter(value=>value!==id);
            changed();
            (neighbor?.querySelector('button') || input).focus();
            close();
            say('Убрано: '+item.name,true);
          });
          chip.append(label,remove);
          chosen.append(chip);
          chips.set(id,chip);
        }
        if (type==='products') input.placeholder=chips.size?'Добавить ещё продукт':initialPlaceholder;
      }};
    }
    function finish(payload, focus) {
      busy=false;activeRequest=null;syncControls();show(payload);if (focus) focusResult();
    }
    async function run(focus=true, localOnly=false) {
      cancelRequest();
      const token=requestId;
      if (!settings.products.length) {syncControls();show(idle);return;}
      settings.submitted=true;S.saveSettings(settings);
      let loader;
      try {
        refreshData();
        if (!catalog.length) throw Error('Catalog unavailable');
        busy=true;syncControls();
        const request=S.clean(settings);
        const assessment=S.assess(catalog,request);
        const endpoint=window.SYTO_RUNTIME?.rankEndpoint;
        let ranked, modelNote='';
        const candidates=request.relax?assessment.outside:assessment.shopping;
        if (!localOnly && endpoint && !assessment.exact.length && candidates.length>1) {
          const controller=new AbortController();
          activeRequest=controller;
          loader=setTimeout(()=>{
            if(token===requestId) show({state:'loading',title:'Подбираем ближайшие варианты',notice:request.relax?'Проверяем отличия от исходных условий.':'Проверяем варианты с докупкой.',groups:[],actions:[{action:'local',label:'Показать подбор из базы'}]});
          },350);
          const timeout=setTimeout(()=>controller.abort(),6500);
          try {
            const pool=S.diverse(candidates,12);
            const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
              cache:'no-store',signal:controller.signal,body:JSON.stringify({
                ids:pool.map(row=>row.recipe.id), products:request.products, excluded:request.excluded,
                diet:request.diet, time:request.time, budget:request.budget, mode:request.mode, relax:request.relax
              })});
            if (!response.ok) throw Error('Ranking unavailable');
            const responseData=await response.json();
            const ids=responseData.ids;
            if (!Array.isArray(ids) || ids.length!==Math.min(pool.length,5) || new Set(ids).size!==ids.length) throw Error('Incomplete ranking');
            const byId=new Map(pool.map(row=>[row.recipe.id,row]));
            ranked=ids.map(id=>byId.get(id));
            if (ranked.some(row=>!row)) throw Error('Unknown recipe');
          } catch (_) {
            ranked=undefined;modelNote='Подбор выполнен по базе рецептов. Модель сейчас недоступна.';
          } finally {clearTimeout(timeout);}
        }
        if (token!==requestId) return;
        const result=S.buildResult(assessment,request,ingredients,ranked,modelNote);
        finish(result,focus);
      } catch (_) {
        if (token!==requestId) return;
        finish({state:'error',title:'Не удалось открыть каталог',notice:'Ваши условия сохранены. Попробуйте загрузить каталог ещё раз.',
          groups:[],actions:[{action:'retry',label:'Повторить'}]},focus);
      } finally {clearTimeout(loader);}
    }
    refreshData();
    if (catalog.length) {
      settings.products=settings.products.filter(id=>ingredients.has(id));
      settings.excluded=settings.excluded.filter(id=>ingredients.has(id));
    }
    form.querySelectorAll('[data-ingredient-field]').forEach(el=>fields.push(setUpField(el)));
    form.addEventListener('change',event=>{
      if (event.target===time || event.target===budget || event.target.name==='mode' || event.target.name==='diet') {
        settings.time=Number(time.value);settings.budget=Number(budget.value);
        settings.mode=form.querySelector('[name=mode]:checked').value;
        settings.diet=diets.filter(el=>el.checked).map(el=>el.value);changed();
      }
    });
    form.addEventListener('submit',event=>{
      event.preventDefault();if (busy || !settings.products.length) return;
      fields.forEach(field=>field.close());run();
    });
    form.addEventListener('reset',event=>{
      event.preventDefault();cancelRequest();settings=S.saveSettings(S.defaults);
      form.querySelectorAll('input[type=text]').forEach(input=>input.value='');
      form.querySelectorAll('.finder-feedback').forEach(el=>el.textContent='');
      form.querySelector('details').open=false;
      syncControls();
      show(idle);
      document.getElementById('ingredients-query').focus();
      fields.forEach(field=>field.close());
    });
    document.addEventListener('pointerdown',event=>{
      fields.forEach(field=>{if (!field.contains(event.target)) field.close();});
    });
    document.addEventListener('click',event=>{
      const button=event.target.closest('[data-picker-action]');
      if (!button) return;
      event.preventDefault();
      switch(button.dataset.pickerAction) {
        case 'relax': settings.relax=true;run();break;
        case 'local': run(true,true);break;
        case 'retry':
          if (!Array.isArray(window.SYTO_RECIPES) || !window.SYTO_RECIPES.length) location.reload();
          else run();
          break;
        case 'reset': form.reset();break;
        case 'edit': document.getElementById('ingredients-query').focus();break;
      }
    });
    syncControls();
    if (!catalog.length) show({state:'error',title:'Не удалось открыть каталог',notice:'Повторите загрузку страницы. Выбранные ранее условия сохранены.',groups:[],actions:[{action:'retry',label:'Повторить'}]});
    else if (settings.submitted && settings.products.length) run(false);
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
