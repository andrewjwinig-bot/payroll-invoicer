:root{
  --bg:#0b0d12;
  --panel:#111522;
  --panel2:#0f1320;
  --text:#e7eaf0;
  --muted:#a7afc2;
  --border:#26304a;
  --accent:#7aa2ff;
  --good:#39d98a;
  --warn:#ffcf5c;
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
  background: radial-gradient(1200px 700px at 20% 0%, #182044 0%, var(--bg) 45%) fixed;
  color:var(--text);
}
.container{max-width:1100px;margin:0 auto;padding:28px 18px 60px}
a{color:var(--accent)}
h1{font-size:28px;margin:0 0 8px}
p{color:var(--muted);margin:0 0 18px;line-height:1.45}
.card{
  background: linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.01));
  border:1px solid var(--border);
  border-radius:16px;
  padding:16px;
  box-shadow:0 10px 30px rgba(0,0,0,.25);
}
.row{display:flex;gap:12px;flex-wrap:wrap}
.col{flex:1;min-width:280px}
.btn{
  appearance:none;border:1px solid var(--border);background:rgba(255,255,255,.03);
  color:var(--text);padding:10px 12px;border-radius:12px;cursor:pointer;
  transition:transform .05s ease, border-color .15s ease;
  font-weight:600;
}
.btn:hover{border-color:#3a4a74}
.btn:active{transform:translateY(1px)}
.btn.primary{background:rgba(122,162,255,.16);border-color:rgba(122,162,255,.35)}
.btn.primary:hover{border-color:rgba(122,162,255,.55)}
.input{
  width:100%;
  border:1px dashed #3a4a74;
  border-radius:12px;
  padding:12px;
  background:rgba(255,255,255,.02);
  color:var(--muted);
}
.pills{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
.pill{
  border:1px solid var(--border);
  background:rgba(255,255,255,.02);
  border-radius:999px;
  padding:8px 10px;
  display:flex;gap:8px;align-items:baseline
}
.pill b{color:var(--text)}
.tableWrap{overflow:auto;border-radius:14px;border:1px solid var(--border);margin-top:14px}
table{width:100%;border-collapse:collapse;min-width:860px;background:rgba(0,0,0,.15)}
th,td{padding:10px 10px;border-bottom:1px solid rgba(38,48,74,.7);text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}
thead th{position:sticky;top:0;background:#0d1220;z-index:1}
tfoot td{font-weight:800;background:#0d1220}
.muted{color:var(--muted)}
.small{font-size:12px}
hr{border:none;border-top:1px solid rgba(38,48,74,.7);margin:14px 0}
