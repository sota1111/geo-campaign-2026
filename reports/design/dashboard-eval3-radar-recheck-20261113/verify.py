import json, math
from pathlib import Path
base=Path(__file__).parent
capture=json.loads((base/'measurements.json').read_text())
raw=json.loads(Path('contests/dashboard/src/data/eval-r3.json').read_text())
checks=0
mismatches=[]
def polygon(points, values, label):
 global checks
 actual=[tuple(map(float,p.split(','))) for p in points.split()]
 n=len(values)
 for i,v in enumerate(values):
  expected=(round(170+v*20*math.cos(-math.pi/2+2*math.pi*i/n),2),round(145+v*20*math.sin(-math.pi/2+2*math.pi*i/n),2))
  checks+=1
  if any(abs(a-b)>.006 for a,b in zip(actual[i],expected)):mismatches.append([label,i,actual[i],expected])
def verify(v):
 global checks
 for plot in v['plots']:
  for series in plot['series']:
   app=raw['portal'] if series['id']=='portal' else raw['apps'][series['id']]
   stats=app['A'] if series['id']=='portal' else app['B'] if plot['title'].startswith('B ') else list(app['C'].values())
   polygon(series['points'],[s['mean'] for s in stats],series['id'])
  for bound in ['min','max']:
   if plot.get(bound):polygon(plot[bound],[s[bound] for s in raw['portal']['A']],bound)
 seen=set()
 for cell in v['cells']:
  ident,idx=cell['id'].rsplit('-',1)
  app=raw['portal'] if ident=='portal' else raw['apps'][ident]
  stats=app['A'] if ident=='portal' else list(app['C'].values()) if cell['id'] in seen else app['B']
  s=stats[int(idx)];expected=f"{s['mean']:.2f}\n{s['min']}〜{s['max']}・{s['n']}名"
  checks+=1
  if cell['text']!=expected:mismatches.append([cell['id'],cell['text'],expected])
  seen.add(cell['id'])
for r in capture['results']:
 for c in r['contests']:
  verify(c['values'])
  if 'all' in c:verify(c['all']['values'])
  for p in c.get('presets',[]):verify(p['values'])
 verify(r['portal']['values'])
result={'checks':checks,'mismatches':mismatches}
(base/'value-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(result,ensure_ascii=False))
