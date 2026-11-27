"""Assemble static pages and a file://-compatible catalogue. Run Python 3.10+."""
from pathlib import Path
from html import escape
import re
import json
import os
from tempfile import NamedTemporaryFile
from textwrap import indent

ROOT=Path(__file__).resolve().parent
PARTS=ROOT/'partials'
PAGES=ROOT/'pages'
DATA=ROOT/'static'/'data'
RECIPES=json.loads((DATA/'recipes.json').read_text(encoding='utf-8'))
BY_ID={r['id']:r for r in RECIPES}

def text_file(p):
    return p.read_text(encoding='utf-8').strip()

def write_ready(path, text):
    data=text.encode('utf-8')
    if path.exists() and path.read_bytes()==data:
        return
    with NamedTemporaryFile(dir=path.parent,delete=False) as out:
        out.write(data)
        pending=Path(out.name)
    try:
        os.replace(pending,path)
    finally:
        pending.unlink(missing_ok=True)

def partial(name):
    return text_file(PARTS/(name+'.html'))

def picker_markup():
    field=partial('ingredient-field')
    products=field.format(kind='products',query_id='ingredients-query',list_id='ingredients-options',
                          label='Продукты',chosen_label='Выбранные продукты',menu_title='Добавить в продукты')
    excluded=field.format(kind='excluded',query_id='exclude-query',list_id='exclude-options',
                          label='Исключить продукты',chosen_label='Исключённые продукты',menu_title='Исключить из подбора')
    markup=partial('picker').replace('  {{products-field}}',indent(products,'  '))
    markup=markup.replace('    {{excluded-field}}',indent(excluded,'    '))
    return markup.replace('{{picker-submit}}',partial('picker-submit'))

def static_card(r,eager):
    card=partial('dish-card').replace('data-dish-link',f'data-dish-link data-recipe="{escape(r["id"])}" href="recipe.html?id={escape(r["id"])}"')
    card=card.replace('data-dish-image',f'data-dish-image src="static/images/{escape(r["image"])}" loading="{"eager" if eager else "lazy"}"')
    fields={'name':escape(r['name']),'minutes':f'≈ {r["minutes"]} мин','price':f'≈ {r["price"]} ₽/порц.'}
    for key,value in fields.items():
        card=card.replace(f'data-dish-{key}></',f'data-dish-{key}>{value}</')
    return card

def html_templates():
    names=['dish-card','state-loading','state-result','state-partial','state-empty','state-error']
    return '\n'.join(f'<template id="{name}">{partial(name)}</template>' for name in names)

def build():
    titles={'index':'Что приготовим?', 'recipe':'Рецепт', 'cart':'Корзина', 'states':'Состояния подбора'}
    initial=[BY_ID[i] for i in ('omelet','buckwheat','soup','beans','potatoes','couscous','rice','pasta') if i in BY_ID]
    picker=picker_markup()
    cook_templates='\n'.join(partial(name) for name in ('kitchen-item','method-item','shopping-item','related-recipe'))
    for page,title in titles.items():
        main=text_file(PAGES/('home.html' if page=='index' else page+'.html'))
        slots={'picker':picker,
               'first-pair':''.join(static_card(BY_ID[i],True) for i in ('rice','pasta')),
               'first-catalog':''.join(static_card(r,False) for r in initial)}
        for name,val in slots.items():
            main=main.replace('{{'+name+'}}',val)
        header=partial('header').replace('{{cart-current}}','aria-current="page"' if page=='cart' else '')
        templates=html_templates()
        if page in ('cart','recipe'):
            templates+='\n'+cook_templates
        scripts=['runtime','icons','../data/catalog','search-engine','site','cooking']
        if page=='index': scripts.append('picker')
        if page in ('index','recipe'): scripts.append('select-menu')
        scripts='\n'.join(f'<script defer src="static/{"data/catalog" if s=="../data/catalog" else "js/"+s}.js"></script>' for s in scripts)
        styles='\n'.join(f'<link rel="stylesheet" href="static/css/{s}.css">' for s in ['tokens','components','home','picker','cooking','select-menu'])
        sprite=text_file(ROOT/'static'/'icons'/'lucide.svg')
        document=f'''<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#fff7f5"><title>{title} — СытоМастер</title>
<meta name="description" content="Подберите блюдо по продуктам, времени и бюджету. Рецепты с пошаговой готовкой, таймером и списком покупок.">
<link rel="icon" href="static/icons/icon.svg" type="image/svg+xml">{styles}
</head><body id="top">{sprite}
{header}
{main}
{partial('footer')}
<noscript><p class="shell">Включите JavaScript, чтобы пользоваться подбором, пошаговой готовкой и корзиной.</p></noscript>
{templates}
{scripts}
</body></html>'''
        if re.search(r'\{\{[^}]+\}\}',document):
            raise ValueError(f'Unresolved include in {page}')
        write_ready(ROOT/(page+'.html'),document)
    # The same data file can be opened directly or served by the local application.
    packed=json.dumps(RECIPES,ensure_ascii=False,separators=(',',':')).replace('</','<\\/')
    write_ready(DATA/'catalog.js','window.SYTO_RECIPES='+packed+';\n')
    print(f'Built {len(titles)} pages and {len(RECIPES)} recipes.')

if __name__=='__main__':
    build()

