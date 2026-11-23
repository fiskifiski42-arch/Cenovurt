#!/usr/bin/env python3
"""Build a small food-price feed from official KZP public daily open-data ZIP archives.
No fabricated prices. Unmatched or ambiguous rows are discarded.
"""
from __future__ import annotations
import csv
import datetime as dt
import io
import json
import math
import os
import re
import sys
import urllib.error
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

HOST = 'https://kolkostruva.bg'
DEST = Path(os.environ.get('CHEFMARGIN_PRICE_OUTPUT', 'chefmargin-data/prices.json'))
MAX_ZIP = 135_000_000
MAX_OFFERS = 12

# Strict reference catalog (not generic string-to-string matching).
# Ingredient aliases used to find retail listings; this is not an endorsement of interchangeability.
RULES = {
 'CHKN': (r'пилешк(?:о|и|а).*?(?:филе|гърд)|(?:филе|гърд).*?пилешк', 'g', r'пушен|маринован|панир|колбас|надениц'),
 'RICE': (r'\bориз\b', 'g', r'оризов|вафл|оризовк|мляко'),
 'ONION': (r'\bлук\b|кромид', 'g', r'зелен|пресен|прах|сушен|шалот'),
 'OIL': (r'\bолио\b|слънчогледово масло', 'ml', r'зехтин|кокос|палм|авокадо'),
 'TOM': (r'доматен сос|домати пасирани|пасирани домати', 'g', r'кетчуп|лютеница'),
 'MOZZ': (r'моцарела|mozzarella', 'g', r'паниран|пюре|спагет|готов|пица|hipp|бебеш|бисквит|сандвич|закуска|салата'),
 'FLOUR': (r'брашно(?:\s|$)|\bflour\b', 'g', r'царевич|оризово|пълнозърнест|ръжено|кокос|бадем'),
 'YEAST': (r'\bмая\b|\byeast\b', 'g', r'маян|маянски|хляб|бисквит|питк|печив|сухар|руло|козунак'),
 'SALT': (r'\bсол\b|\bsalt\b', 'g', r'вана|препарат|соли'),
 'BEEF': (r'телешк(?:а|о|и).*?кайма|говежд(?:а|о|и).*?кайма|кайма.*?телешк', 'g', r'смес|свинск'),
 'BUN': (r'(?:бургер|хамбургер).*?(?:питк|хлебч)|(?:питк|хлебч).*?(?:бургер|хамбургер)', 'pcs', ''),
 'CHEESE': (r'чедър|cheddar', 'g', ''),
 'POTATO': (r'картофи|картоф(?:\s|$)', 'g', r'замраз|фрит|чипс|пюре|бланш|нишесте'),
 'MAYO': (r'майонеза|mayonnaise', 'g', r'сос с майонеза'),
 'EGGS': (r'яйца|яйце', 'pcs', r'шоколад|бонбон'),
 'BUTTER': (r'краве масло|масло краве', 'g', r'фъстъч|пакетч|бисквит|вафл|сладки|крем|паста|козметик|тесто'),
 'GARLIC': (r'чесън', 'g', r'прах|сушен|гранул'),
 'TOMATO': (r'домати|домат(?:\s|$)', 'g', r'сушен|консерв|сос|пюре|марин|паста|цели|белени|салата|трапез|стерилизирани'),
 'PORK': (r'свинск(?:о|и|а).*?(?:бонфиле|филе)|(?:бонфиле|филе).*?свинск', 'g', r'колбас|шунка|пушен|врат|бут'),
 'MILK': (r'прясно мляко|мляко прясно', 'ml', r'бадем|овес|соя|кокос'),
 'YOGURT': (r'кисело мляко', 'g', r'протеинов|напитка'),
 'WHITE_CHEESE': (r'бяло саламурено сирене|краве сирене|сирене краве', 'g', r'топен|крема'),
 'YELLOW_CHEESE': (r'кашкавал', 'g', r'заместител'),
 'SUGAR': (r'\bзахар\b', 'g', r'ванилова|пудра|кафява|заместител'),
 'CREAM': (r'готварска сметана|сметана за готвене', 'ml', r'спрей|сладкарска'),
 'OLIVE_OIL': (r'\bзехтин\b|olive oil', 'ml', ''),
 'PEPPER': (r'\bчушки\b|\bчушка\b', 'g', r'печен|маринован|сушен|пипер|кашкавал|сирене|пюре|паста|хляб|салата'),
 'CUCUMBER': (r'краставици|краставица', 'g', r'кисели|туршия'),
 'MUSHROOM': (r'гъби печурки|печурки', 'g', r'консерва|сушен'),
 'CARROT': (r'моркови|морков', 'g', r'сок|маринован|хляб|пюре|салата|бебеш|супа|спагет|печив'),
 'CHICKEN_LEGS': (r'пилешк(?:о|и|а).*?(?:бут|долно бутче)', 'g', r'пушен|маринован|панир'),
}
compiled = {key: (re.compile(pat, re.I), unit, re.compile(ex, re.I) if ex else None) for key, (pat, unit, ex) in RULES.items()}

# Named pack quantity, g/ml/pcs. For a single KG product with no number ('домати кг'), assume 1 kg.
size_pattern = re.compile(r'(?<!\d)(\d{1,4}(?:[.,]\d{1,3})?)\s*(кг|kg|гр(?:ама)?|г|g|мл|ml|литра?|л\b|бр(?:\.|оя|ой)?|pcs)\b', re.I)
weight_token = re.compile(r'(?<!\w)(кг|kg|килограм)(?!\w)', re.I)

def measure(name: str, wanted: str):
    found = []
    for match in size_pattern.finditer(name):
        val = float(match.group(1).replace(',', '.'))
        unit = match.group(2).lower()
        if unit in ('кг','kg'): kind, qty = 'g', val * 1000
        elif unit.startswith(('гр', 'г', 'g')): kind, qty = 'g', val
        elif unit in ('л', 'литра', 'литр'): kind, qty = 'ml', val * 1000
        elif unit in ('мл','ml'): kind, qty = 'ml', val
        else: kind, qty = 'pcs', val
        if kind == wanted and 0 < qty < 100000: found.append(qty)
    if found:
        # Approximate variable-weight packs (~3 kg meat, ~10 kg onions) are typically quoted per KG in KZP.
        if wanted=='g' and re.search(r'~\s*\d+(?:[.,]\d+)?\s*(?:кг|kg)',name,re.I): return 1000
        # Multi-packs containing multiple quantities are ambiguous; do not guess.
        if len(found)>1 and abs(found[0]-found[-1])>0.001: return None
        return found[0]
    if wanted=='g' and weight_token.search(name): return 1000
    return None


def parse_row(row, origin):
    if len(row) < 7: return []
    name = row[2].strip().strip('"')
    if len(name) < 3 or len(name)>300: return []
    try:
        regular=float(row[5].strip().replace(',', '.'))
        promo=float(row[6].strip().replace(',', '.')) if row[6].strip() else 0
        price=promo if 0<promo<regular else regular
        if not (.06 < price < 2000 and math.isfinite(price)):return []
    except (ValueError, OverflowError): return []
    normalized = ' '.join(name.lower().split())
    # Never mix ingredients; match as little as possible.
    found=[]
    for key, (pat, unit, excluded) in compiled.items():
        if not pat.search(normalized) or (excluded and excluded.search(normalized)):continue
        qty=measure(normalized,unit)
        if qty is None: continue
        per=price/qty
        if not (0.00005 < per < (80 if unit=='pcs' else .5)):continue
        store=row[1].strip()[:100] or origin[:100]
        found.append((key, {'name':name[:130],'store':store,'price':round(price,2),'qty':qty,'unit':unit,'perUnit':round(per,9),'link':HOST+'/opendata','source':'КЗП · Колко струва'}))
    return found


def read_archive(binary):
    grouped=defaultdict(list)
    with zipfile.ZipFile(io.BytesIO(binary)) as z:
        files=[file for file in z.infolist() if file.filename.lower().endswith('.csv') and not file.is_dir() and file.file_size<85_000_000]
        for info in files:
            with z.open(info) as source:
                raw=source.read()
            decoded=raw.decode('utf-8-sig',errors='replace')
            reader=csv.reader(io.StringIO(decoded),delimiter=',',quotechar='"')
            for line in reader:
                for key, offer in parse_row(line,info.filename):
                    grouped[key].append(offer)
    return grouped, len(files)



def chain_group(name):
    n=name.casefold()
    for marker, key in [('метро','metro'),('metro','metro'),('кауфланд','kaufland'),('kaufland','kaufland'),('лидл','lidl'),('lidl','lidl'),('билла','billa'),('billa','billa'),('т маркет','tmarket'),('фантастико','fantastico'),('минмарт','minimart'),('минимарт','minimart'),('жанет','janet'),('болеро','bolero')]:
        if marker in n: return key
    # independent shop: preserve unique name, but collapse numbered branches of same chain
    return re.sub(r'\d{1,5}', '', n.split(' - ')[0])[:48].strip()

def summarize(grouped, date):
    entries={}
    for key, offers in grouped.items():
        dedup={}
        for offer in offers:
            # Keep lowest offer for a chain/store+product match
            k=(offer['store'].casefold(),offer['name'].casefold())
            if k not in dedup or offer['perUnit'] < dedup[k]['perUnit']: dedup[k]=offer
        rows=sorted(dedup.values(),key=lambda x:x['perUnit'])
        # Drop extreme outliers via median band; don't hide valid cheap offers for consistent products.
        if not rows: continue
        median=rows[len(rows)//2]['perUnit']
        rows=[r for r in rows if median/4 <= r['perUnit'] <= median*4]
        if rows:
            # Distinct store names + lowest, middle, high observations (avoid 12 same-chain matches)
            store_list=[];seen=set();chaincounts=defaultdict(int)
            for row in rows:
                storekey=row['store'].casefold()
                if storekey in seen: continue
                chain = chain_group(row['store'])
                if chaincounts[chain]>=2: continue
                seen.add(storekey);chaincounts[chain]+=1;store_list.append(row)
                if len(store_list)>=MAX_OFFERS:break
            entries[key]=store_list
    return {'version':1,'source':'КЗП · Колко струва','sourceUrl':HOST+'/opendata','sourceDate':date,
            'createdAt':dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
            'currency':'EUR','items':entries,
            'scope':'Retail public-store listings; not supplier, METRO contract or wholesale prices'}


def run():
    today=dt.datetime.now(dt.timezone.utc).date()
    errors=[]
    for back in range(0,10):
        date=(today-dt.timedelta(days=back)).isoformat()
        url=f'{HOST}/opendata_files/{date}.zip'
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'ChefMarginPriceSync/1.0 (+https://github.com/fiskifiski42-arch/Cenovurt)','Accept':'application/zip'})
            with urllib.request.urlopen(req,timeout=40) as res:
                ct=res.headers.get('Content-Type','')
                data=res.read(MAX_ZIP+1)
                if len(data)>MAX_ZIP:raise ValueError('Archive is too large')
            if not zipfile.is_zipfile(io.BytesIO(data)):raise ValueError(f'Not a ZIP: {ct}')
            items,count=read_archive(data)
            feed=summarize(items,date)
            total=sum(len(v) for v in feed['items'].values())
            if total<4: raise ValueError(f'No usable food offers from {count} CSVs')
            DEST.parent.mkdir(parents=True,exist_ok=True)
            DEST.write_text(json.dumps(feed,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
            print(f'OK {date}: {count} CSVs, {len(items)} ingredient groups, {total} offers; {DEST}',flush=True)
            return 0
        except Exception as e:
            errors.append(f'{date}: {type(e).__name__}: {str(e)[:180]}')
            print('No usable archive '+errors[-1],flush=True)
    print('PRICE FEED UNAVAILABLE. Existing data must not be replaced with demo prices.',file=sys.stderr)
    for e in errors: print(e,file=sys.stderr)
    return 2

if __name__=='__main__':sys.exit(run())
