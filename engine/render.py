"""kb_scanner/render.py — interactive map for a kb-blueprint-graph/1 graph.

Adapted from the HTML renderer of an earlier system-map script (workstreams -> top-level folders,
inventory header -> corpus hash). Pure function, stdlib only: runs under CPython and Pyodide, so the CLI and the
browser produce the same page from the same graph.
"""
from __future__ import annotations

import html
import json

CSS = """
:root{--navy:#1E2761;--coral:#F96167;--cream:#FAF7F2;--ink:#0E1330;--mute:#5b6280;--line:#e4dfd5;--card:#ffffff}
*{box-sizing:border-box}html,body{margin:0;background:var(--cream);color:var(--ink);font:15px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
header{background:var(--navy);color:var(--cream);padding:28px 32px 46px}
h1{font-family:Fraunces,Georgia,"Times New Roman",serif;font-weight:600;font-size:28px;margin:0 0 4px;letter-spacing:-.01em}
h2{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:19px;margin:0 0 10px;color:var(--navy)}
h3{font-size:14px;margin:16px 0 6px}
.sub{opacity:.82;font-size:13px}.sub code{color:#fff}
main{max-width:1280px;margin:0 auto;padding:0 16px 60px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:-30px 0 18px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.kpi b{display:block;font-family:Fraunces,Georgia,serif;font-size:22px;color:var(--navy)}.kpi span{font-size:12px;color:var(--mute)}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:18px;min-width:0}
.grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:18px}
@media(max-width:900px){.grid{grid-template-columns:1fr}}
svg text{font:11px Inter,system-ui,sans-serif;fill:var(--ink)}
input,select{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;width:100%}
.row{display:flex;gap:8px;margin-bottom:10px}.row>*{flex:1;min-width:0}
ul.res{list-style:none;margin:0;padding:0;max-height:420px;overflow:auto}
ul.res li{padding:6px 8px;border-bottom:1px solid var(--line);cursor:pointer;font-size:13px;word-break:break-all}
ul.res li:hover{background:#fff4f3}
.tag{display:inline-block;font-size:11px;padding:1px 6px;border-radius:999px;background:var(--cream);border:1px solid var(--line);color:var(--mute);margin-right:4px}
.tag.c{background:var(--coral);border-color:var(--coral);color:#fff}
.tw{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:12.5px}td,th{text-align:left;padding:5px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mute);font-weight:600}code{font:12px ui-monospace,Menlo,monospace;word-break:break-all}
.det{max-height:620px;overflow:auto}.muted{color:var(--mute)}a{color:var(--navy)}
"""

JS = r"""
const D=JSON.parse(document.getElementById('data').textContent);const N=D.N,E=D.E;
const out={},inn={};E.forEach((e,i)=>{(out[e[0]]=out[e[0]]||[]).push(i);if(e[1]>=0)(inn[e[1]]=inn[e[1]]||[]).push(i)});
const $=s=>document.querySelector(s);const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hub=N.map((n,i)=>[n,i]).filter(([n])=>n[1]!=='file');
const ws=hub.filter(([n])=>n[1]==='folder'),oth=hub.filter(([n])=>n[1]!=='folder');
const W=720,H=720,cx=W/2,cy=H/2,pos={},PAD=170;
ws.forEach(([n,i],k)=>{const a=2*Math.PI*k/Math.max(1,ws.length)-Math.PI/2;pos[i]=[cx+300*Math.cos(a),cy+300*Math.sin(a)]});
oth.forEach(([n,i],k)=>{const a=2*Math.PI*k/Math.max(1,oth.length)-Math.PI/2;pos[i]=[cx+160*Math.cos(a),cy+160*Math.sin(a)]});
const fIdx={};N.forEach((n,i)=>{if(n[1]==='folder')fIdx[n[2]]=i});
const wsOf=i=>{const n=N[i];if(n[1]==='folder')return i;if(n[1]==='file'){return fIdx[n[4]]!==undefined?fIdx[n[4]]:-1}return pos[i]?i:-1};
const agg={};E.forEach(e=>{if(e[1]<0)return;if(e[2]==='depends_on')return;const a=wsOf(e[0]),b=wsOf(e[1]);if(a<0||b<0||a===b)return;const k=a+'_'+b;agg[k]=(agg[k]||0)+e[5]});
let svg=`<svg viewBox="${-PAD} -10 ${W+2*PAD} ${H+20}" width="100%" role="img" aria-label="Folder map">`;
const mx=Math.max(1,...Object.values(agg));
Object.entries(agg).sort((x,y)=>x[1]-y[1]).forEach(([k,v])=>{const [a,b]=k.split('_').map(Number);const w=0.4+4*Math.sqrt(v/mx);
svg+=`<line x1="${pos[a][0]}" y1="${pos[a][1]}" x2="${pos[b][0]}" y2="${pos[b][1]}" stroke="${N[b][1]==='folder'?'#1E2761':'#F96167'}" stroke-opacity="${0.12+0.5*v/mx}" stroke-width="${w}"/>`});
hub.forEach(([n,i])=>{const [x,y]=pos[i];const isw=n[1]==='folder';
svg+=`<g class="hn" data-i="${i}" style="cursor:pointer"><circle cx="${x}" cy="${y}" r="${isw?9:5}" fill="${isw?'#1E2761':n[1]==='person'?'#9a7b4f':n[1]==='external'?'#8b90a8':'#F96167'}"/><text x="${x+(x<cx?-12:12)}" y="${y+4}" text-anchor="${x<cx?'end':'start'}">${esc(n[2].length>28?n[2].slice(0,27)+'…':n[2])}</text></g>`});
svg+='</svg>';$('#ov').innerHTML=hub.length?svg:'<p class="muted">No folders, people or external systems detected.</p>';
document.querySelectorAll('.hn').forEach(g=>g.onclick=()=>show(+g.dataset.i));
function show(i){const n=N[i];const o=(out[i]||[]),r=(inn[i]||[]);
let h=`<h2>${esc(n[2])}</h2><p><span class="tag c">${esc(n[1])}</span>${n[5].includes('A')?'<span class="tag">archived</span>':''}${n[5].includes('S')?'<span class="tag">superseded</span>':''}</p>${n[3]?`<p><code>${esc(n[3])}</code></p>`:''}`;
const tbl=(ids,dir)=>'<div class="tw"><table><tr><th>'+(dir?'to':'from')+'</th><th>type</th><th>source file : line</th><th>n</th></tr>'+ids.slice(0,400).map(k=>{const e=E[k];const other=dir?e[1]:e[0];return `<tr><td><a href="#" data-i="${other}">${esc(N[other]?N[other][2]:'?')}</a></td><td>${esc(e[2])}</td><td><code>${esc(e[3])}:${e[4]}</code><div class="muted">${esc(e[6])}</div></td><td>${e[5]}</td></tr>`}).join('')+'</table></div>'+(ids.length>400?`<p class="muted">+${ids.length-400} more</p>`:'');
h+=`<h3>Outbound (${o.length})</h3>${tbl(o,1)}<h3>Inbound (${r.length})</h3>${tbl(r,0)}`;$('#det').innerHTML=h;
$('#det').querySelectorAll('a[data-i]').forEach(a=>a.onclick=ev=>{ev.preventDefault();show(+a.dataset.i)});}
function search(){const q=$('#q').value.toLowerCase(),k=$('#k').value;const res=[];
for(let i=0;i<N.length&&res.length<300;i++){const n=N[i];if(k&&n[1]!==k)continue;if(!q||n[0].toLowerCase().includes(q))res.push(i)}
$('#res').innerHTML=res.map(i=>`<li data-i="${i}"><span class="tag">${esc(N[i][1])}</span>${esc(N[i][0].replace(/^file:/,''))} <span class="muted">(${(out[i]||[]).length}→ / ←${(inn[i]||[]).length})</span></li>`).join('');
$('#res').querySelectorAll('li').forEach(li=>li.onclick=()=>show(+li.dataset.i));}
$('#q').oninput=search;$('#k').onchange=search;search();
"""


def render_html(graph: dict) -> bytes:
    nodes = graph["nodes"]
    idx = {n["id"]: i for i, n in enumerate(nodes)}
    N = [[n["id"], n["kind"], n.get("label", ""), n.get("path", ""), n.get("folder", ""),
          ("A" if n.get("archived") else "") + ("S" if n.get("superseded") else "")] for n in nodes]
    E = [[idx[e["source"]], idx.get(e["target"], -1), e["type"], e["src_file"], e["line"], e["count"], e["evidence"]]
         for e in graph["edges"] if e["source"] in idx and e["target"] in idx]
    payload = json.dumps({"N": N, "E": E, "stats": graph["stats"]}, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"))
    payload = payload.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    st = graph["stats"]
    kpis = "".join('<div class="kpi"><b>%s</b><span>%s</span></div>' % (html.escape(str(v)), html.escape(k))
                   for k, v in [("files", st["files"]), ("edges", st["edges"]), ("files read", st["files_mined"]),
                                ("unresolved refs", st["unresolved_refs"]), ("orphans", st["orphans"]),
                                ("rule lines", st["rule_lines"])])
    opts = '<option value="">all kinds</option>' + "".join(
        '<option>%s</option>' % html.escape(k) for k in sorted(st["nodes_by_kind"]))
    label = html.escape(graph.get("root_label", "corpus"))
    doc = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Knowledge Map</title><style>%s</style></head><body>
<header><h1>%s — knowledge map</h1><div class="sub">Deterministic graph · corpus sha256 <code>%s</code> · engine %s. Every edge names the file and line it came from.</div></header>
<main><div class="kpis">%s</div>
<div class="grid"><section class="panel"><h2>Folders, people, external systems</h2><p class="muted">Outer ring: top-level folders. Inner ring: people, external systems, tags. Line weight = citing edges. Click a node.</p><div id="ov"></div></section>
<section class="panel"><h2>Find a node</h2><div class="row"><input id="q" placeholder="path, name, person…" aria-label="search"><select id="k" aria-label="kind">%s</select></div><ul class="res" id="res"></ul></section></div>
<section class="panel det" id="det"><p class="muted">Select a node to see its edges with source file and line.</p></section>
</main><script id="data" type="application/json">%s</script><script>%s</script></body></html>
""" % (CSS, label, graph["corpus_sha256"][:16], html.escape(graph["engine_version"]), kpis, opts, payload, JS)
    return doc.encode("utf-8")
