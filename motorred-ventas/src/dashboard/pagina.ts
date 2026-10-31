// Página del dashboard (GET /dashboard). Va como texto para que se compile dentro de dist/ y
// funcione igual en Docker. Regla al editar: el JavaScript de la página NO puede usar comillas
// invertidas ni ${...} (rompen esta plantilla); se concatena con +.
export const PAGINA = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard · MotorRed</title>
<style>
  :root {
    --bg:#f5f6fa; --panel:#fff; --borde:#e3e6ee; --texto:#1b2133; --suave:#6a7388;
    --acento:#5b52f0; --acento2:#e9e7ff; --ok:#16a05a; --mal:#d6453d; --aviso:#c58a12; --rev:#8a4fd6; --gris:#7b8499;
    --okbg:#e5f6ec; --malbg:#fdebea; --avisobg:#fdf3dc; --revbg:#f1e8fb; --grisbg:#eceef3;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#0e1118; --panel:#161b26; --borde:#262d3c; --texto:#e8ebf3; --suave:#8f99ae;
      --acento:#8c85ff; --acento2:#25224d; --ok:#4cc38a; --mal:#ff7b72; --aviso:#e3b24a; --rev:#b98cf0; --gris:#98a1b5;
      --okbg:#13291f; --malbg:#331a19; --avisobg:#332a12; --revbg:#271c3a; --grisbg:#222939;
    }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--texto); font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; }
  header { background:var(--panel); border-bottom:1px solid var(--borde); position:sticky; top:0; z-index:5; }
  .cab { display:flex; flex-wrap:wrap; align-items:center; gap:10px 16px; padding:12px 20px; }
  h1 { font-size:17px; margin:0; font-weight:650; display:flex; align-items:center; gap:10px; }
  h1 i { width:26px; height:26px; border-radius:8px; background:var(--acento); color:#fff; display:grid; place-items:center; font-style:normal; font-size:13px; font-weight:800; }
  h1 small { color:var(--suave); font-weight:400; }
  .der { margin-left:auto; display:flex; align-items:center; gap:10px; color:var(--suave); font-size:12.5px; }
  .punto { width:8px; height:8px; border-radius:50%; background:var(--ok); display:inline-block; }
  .punto.mal { background:var(--mal); }
  nav { display:flex; gap:2px; padding:0 14px; overflow-x:auto; }
  nav button { background:none; border:0; border-bottom:2px solid transparent; padding:10px 14px; font:inherit; color:var(--suave); cursor:pointer; white-space:nowrap; }
  nav button:hover { color:var(--texto); }
  nav button.act { color:var(--acento); border-bottom-color:var(--acento); font-weight:600; }
  main { max-width:1200px; margin:0 auto; padding:20px; }
  section { display:none; } section.act { display:block; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:14px; margin-bottom:16px; }
  .kpi { background:var(--panel); border:1px solid var(--borde); border-radius:12px; padding:16px 18px; }
  .kpi .t { color:var(--suave); font-size:12.5px; }
  .kpi .v { font-size:26px; font-weight:700; letter-spacing:-.02em; margin-top:2px; }
  .kpi .s { color:var(--suave); font-size:12px; margin-top:2px; }
  .kpi.alerta { border-color:var(--mal); } .kpi.alerta .v { color:var(--mal); }
  .rejilla { display:grid; grid-template-columns:repeat(auto-fit,minmax(340px,1fr)); gap:14px; margin-bottom:14px; }
  .caja { background:var(--panel); border:1px solid var(--borde); border-radius:12px; padding:16px 18px; min-width:0; }
  .caja h2 { font-size:13.5px; margin:0 0 12px; font-weight:650; }
  .caja h2 small { color:var(--suave); font-weight:400; margin-left:6px; }
  .vacio { color:var(--suave); font-size:13px; padding:8px 0; }
  .barra { display:grid; grid-template-columns:120px 1fr auto; gap:10px; align-items:center; margin:7px 0; font-size:13px; }
  .barra .pista { background:var(--grisbg); border-radius:6px; height:10px; overflow:hidden; }
  .barra .relleno { height:100%; border-radius:6px; }
  .barra .num { color:var(--suave); font-variant-numeric:tabular-nums; white-space:nowrap; }
  .scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:var(--suave); font-weight:500; font-size:12px; padding:7px 10px; border-bottom:1px solid var(--borde); white-space:nowrap; }
  td { padding:8px 10px; border-bottom:1px solid var(--borde); vertical-align:top; }
  td.n, th.n { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  tr.click { cursor:pointer; } tr.click:hover td { background:var(--acento2); }
  .mono { font-family:ui-monospace,Consolas,monospace; font-size:12px; }
  .badge { display:inline-block; padding:2px 9px; border-radius:99px; font-size:12px; font-weight:550; white-space:nowrap; }
  .b-ok { background:var(--okbg); color:var(--ok); } .b-mal { background:var(--malbg); color:var(--mal); }
  .b-aviso { background:var(--avisobg); color:var(--aviso); } .b-rev { background:var(--revbg); color:var(--rev); }
  .b-gris { background:var(--grisbg); color:var(--gris); }
  .filtros { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:12px; }
  input, select, button.btn { font:inherit; color:var(--texto); background:var(--panel); border:1px solid var(--borde); border-radius:8px; padding:7px 11px; }
  input { min-width:240px; } input:focus, select:focus { outline:2px solid var(--acento2); border-color:var(--acento); }
  button.btn { cursor:pointer; } button.btn:hover { border-color:var(--acento); color:var(--acento); }
  .aviso-caja { background:var(--avisobg); color:var(--aviso); border:1px solid var(--aviso); border-radius:10px; padding:10px 14px; margin-bottom:14px; font-size:13px; }
  .estado-ok { background:var(--okbg); color:var(--ok); border-radius:10px; padding:10px 14px; font-size:13px; margin-bottom:14px; }
  .estado-mal { background:var(--malbg); color:var(--mal); border-radius:10px; padding:10px 14px; font-size:13px; margin-bottom:14px; }
  .servicios { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; }
  .serv { background:var(--panel); border:1px solid var(--borde); border-radius:12px; padding:16px 18px; }
  .serv .nom { font-weight:650; text-transform:capitalize; display:flex; align-items:center; gap:8px; }
  .serv .u { color:var(--suave); font-size:12px; margin-top:4px; word-break:break-all; }
  dialog { border:1px solid var(--borde); border-radius:14px; background:var(--panel); color:var(--texto); padding:0; width:min(820px,94vw); max-height:88vh; }
  dialog::backdrop { background:rgba(10,12,20,.55); }
  .dlg-cab { display:flex; align-items:center; gap:12px; padding:16px 20px; border-bottom:1px solid var(--borde); position:sticky; top:0; background:var(--panel); }
  .dlg-cab h3 { margin:0; font-size:16px; } .dlg-cab button { margin-left:auto; }
  .dlg-cuerpo { padding:6px 20px 20px; overflow:auto; max-height:calc(88vh - 62px); }
  .dlg-cuerpo h4 { margin:18px 0 6px; font-size:13px; }
  .grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:6px 18px; margin-top:12px; }
  .grid2 div span { display:block; color:var(--suave); font-size:12px; }
  @media (max-width:600px) { main { padding:12px; } .cab { padding:10px 12px; } .barra { grid-template-columns:90px 1fr auto; } input { min-width:0; width:100%; } }
</style>
</head>
<body>
<header>
  <div class="cab">
    <h1><i>M</i>Dashboard <small>servicio: __SERVICIO__</small></h1>
    <div class="der"><span class="punto" id="punto"></span><span id="actualizado">cargando…</span>
      <label><input type="checkbox" id="auto" checked style="min-width:0"> auto (15 s)</label>
      <button class="btn" id="refrescar">Actualizar</button>
      <a href="/panel" style="color:var(--acento)" id="enlace-panel">Panel de logs →</a></div>
  </div>
  <nav id="tabs">
    <button data-t="resumen" class="act">Resumen</button>
    <button data-t="ventas">Ventas</button>
    <button data-t="contabilidad">Contabilidad</button>
    <button data-t="riesgo">Cobros y riesgo</button>
    <button data-t="facturacion">Taller y facturación</button>
    <button data-t="servicios">Servicios</button>
  </nav>
</header>
<main>
  <div id="avisos"></div>

  <section id="s-resumen" class="act">
    <div class="kpis" id="kpis"></div>
    <div class="rejilla">
      <div class="caja"><h2>Ventas por estado</h2><div id="g-estado"></div></div>
      <div class="caja"><h2>Ventas de los últimos 14 días</h2><div id="g-dia"></div></div>
    </div>
    <div class="caja"><h2>Ventas en revisión <small>requieren a una persona</small></h2><div class="scroll" id="t-revision"></div></div>
  </section>

  <section id="s-ventas">
    <div class="filtros">
      <input id="f-texto" placeholder="Buscar por venta, orden, nombre o documento…">
      <select id="f-estado"><option value="">Todos los estados</option></select>
      <button class="btn" id="f-buscar">Buscar</button>
    </div>
    <div class="caja"><div class="scroll" id="t-ventas"></div></div>
  </section>

  <section id="s-contabilidad">
    <div id="conciliacion"></div>
    <div class="caja" style="margin-bottom:14px"><h2>Dispersión por beneficiario <small>lo que le toca a cada uno</small></h2><div class="scroll" id="t-disp"></div></div>
    <div class="caja"><h2>Asientos por cuenta <small>partida doble</small></h2><div class="scroll" id="t-cuentas"></div></div>
  </section>

  <section id="s-riesgo">
    <div class="rejilla">
      <div class="caja"><h2>Cobros pedidos a la pasarela</h2><div id="g-cobros"></div></div>
      <div class="caja"><h2>Eventos recibidos de la pasarela <small>webhook</small></h2><div class="scroll" id="t-eventos"></div></div>
      <div class="caja"><h2>Decisiones del agente de riesgo</h2><div id="g-riesgo"></div></div>
      <div class="caja"><h2>Origen de la decisión</h2><div id="g-fuente"></div></div>
    </div>
  </section>

  <section id="s-facturacion">
    <div class="rejilla">
      <div class="caja"><h2>Cotizaciones del taller</h2><div id="g-cot"></div></div>
      <div class="caja"><h2>Pagos PSE</h2><div id="g-pse"></div></div>
    </div>
    <div class="caja"><h2>Cotizaciones recientes</h2><div class="scroll" id="t-cot"></div></div>
  </section>

  <section id="s-servicios">
    <div class="servicios" id="servicios"></div>
  </section>
</main>

<dialog id="dlg">
  <div class="dlg-cab"><h3 id="dlg-titulo"></h3><span id="dlg-estado"></span><button class="btn" id="dlg-cerrar">Cerrar</button></div>
  <div class="dlg-cuerpo" id="dlg-cuerpo"></div>
</dialog>

<script>
(function () {
  var TOKEN = new URLSearchParams(location.search).get('token');
  var actual = 'resumen';
  var enlace = document.getElementById('enlace-panel');
  if (TOKEN) enlace.href = '/panel?token=' + encodeURIComponent(TOKEN);

  var COLOR = { pagada:'var(--ok)', liquidada:'var(--ok)', aprobado:'var(--ok)', aceptada:'var(--ok)', bajo:'var(--ok)',
    pendiente_pago:'var(--aviso)', pendiente:'var(--aviso)', pendiente_respuesta:'var(--aviso)', medio:'var(--aviso)',
    pago_rechazado:'var(--mal)', rechazado:'var(--mal)', rechazada:'var(--mal)', anulada:'var(--mal)', alto:'var(--mal)',
    en_revision:'var(--rev)', reembolsada:'var(--gris)', reembolsado:'var(--gris)' };
  var CLASE = { pagada:'ok', liquidada:'ok', aprobado:'ok', aceptada:'ok', bajo:'ok', pagado:'ok', confirmado:'ok',
    pendiente_pago:'aviso', pendiente:'aviso', pendiente_respuesta:'aviso', medio:'aviso',
    pago_rechazado:'mal', rechazado:'mal', rechazada:'mal', anulada:'mal', alto:'mal',
    en_revision:'rev', reembolsada:'gris', reembolsado:'gris' };

  function api(ruta) {
    var u = '/dashboard/api/' + ruta;
    if (TOKEN) u += (u.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN);
    return fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, texto) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    return e;
  }
  function limpiar(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function pesos(v) { return '$' + Math.round(Number(v) || 0).toLocaleString('es-CO'); }
  function num(v) { return (Number(v) || 0).toLocaleString('es-CO'); }
  function fecha(v) { if (!v) return '—'; var d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }); }
  function nombre(s) { s = String(s == null ? '' : s).replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); }
  function badge(estado) { return el('span', 'badge b-' + (CLASE[estado] || 'gris'), nombre(estado)); }
  function vacio(c, t) { limpiar(c).appendChild(el('div', 'vacio', t || 'Sin datos todavía.')); }

  function barras(c, filas, opts) {
    limpiar(c);
    if (!filas || !filas.length) return vacio(c);
    var max = Math.max.apply(null, filas.map(function (f) { return f.n; })) || 1;
    filas.forEach(function (f) {
      var fila = el('div', 'barra');
      fila.appendChild(el('span', '', nombre(f.estado || f.nivel_riesgo || f.fuente)));
      var pista = el('div', 'pista'), rel = el('div', 'relleno');
      rel.style.width = Math.max(3, f.n / max * 100) + '%';
      rel.style.background = COLOR[f.estado || f.nivel_riesgo] || 'var(--acento)';
      pista.appendChild(rel); fila.appendChild(pista);
      var extra = (opts && opts.monto && f.monto != null) ? '  ·  ' + pesos(f.monto) : (opts && opts.ms && f.ms != null ? '  ·  ' + Math.round(f.ms) + ' ms' : '');
      fila.appendChild(el('span', 'num', num(f.n) + extra));
      c.appendChild(fila);
    });
  }

  function tabla(c, cols, filas, alClic) {
    limpiar(c);
    if (!filas || !filas.length) return vacio(c);
    var t = el('table'), cab = el('tr');
    cols.forEach(function (k) { cab.appendChild(el('th', k.n ? 'n' : '', k.t)); });
    var th = el('thead'); th.appendChild(cab); t.appendChild(th);
    var tb = el('tbody');
    filas.forEach(function (f) {
      var tr = el('tr', alClic ? 'click' : '');
      cols.forEach(function (k) {
        var td = el('td', (k.n ? 'n ' : '') + (k.mono ? 'mono' : ''));
        var v = f[k.k];
        if (k.f) { var r = k.f(v, f); if (r && r.nodeType) td.appendChild(r); else td.textContent = r; }
        else td.textContent = (v === null || v === undefined || v === '') ? '—' : v;
        tr.appendChild(td);
      });
      if (alClic) tr.addEventListener('click', function () { alClic(f); });
      tb.appendChild(tr);
    });
    t.appendChild(tb); c.appendChild(t);
  }

  function kpi(t, v, s, alerta) {
    var k = el('div', 'kpi' + (alerta ? ' alerta' : ''));
    k.appendChild(el('div', 't', t)); k.appendChild(el('div', 'v', v)); if (s) k.appendChild(el('div', 's', s));
    return k;
  }

  function graficoDias(c, dias) {
    limpiar(c);
    if (!dias || !dias.length) return vacio(c, 'No hay ventas en los últimos 14 días.');
    var W = 560, H = 190, pad = 26, max = Math.max.apply(null, dias.map(function (d) { return d.n; })) || 1;
    var ancho = (W - pad * 2) / dias.length, ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.style.width = '100%'; svg.style.height = 'auto';
    dias.forEach(function (d, i) {
      var h = d.n / max * (H - 56), x = pad + i * ancho + ancho * 0.18, y = H - 26 - h;
      var r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', ancho * 0.64); r.setAttribute('height', Math.max(h, 2));
      r.setAttribute('rx', 4); r.setAttribute('fill', 'var(--acento)');
      var tit = document.createElementNS(ns, 'title'); tit.textContent = d.dia + ': ' + d.n + ' ventas, recaudado ' + pesos(d.recaudado);
      r.appendChild(tit); svg.appendChild(r);
      var v = document.createElementNS(ns, 'text');
      v.setAttribute('x', x + ancho * 0.32); v.setAttribute('y', y - 5); v.setAttribute('text-anchor', 'middle');
      v.setAttribute('font-size', '11'); v.setAttribute('fill', 'var(--texto)'); v.textContent = d.n; svg.appendChild(v);
      var l = document.createElementNS(ns, 'text');
      l.setAttribute('x', x + ancho * 0.32); l.setAttribute('y', H - 8); l.setAttribute('text-anchor', 'middle');
      l.setAttribute('font-size', '10'); l.setAttribute('fill', 'var(--suave)'); l.textContent = d.dia.slice(5); svg.appendChild(l);
    });
    c.appendChild(svg);
  }

  function pintarAvisos(avisos) {
    var c = limpiar($('avisos'));
    if (avisos && avisos.length) {
      var b = el('div', 'aviso-caja', 'Algunas consultas fallaron (¿migraciones pendientes?): ' + avisos.join(' | '));
      c.appendChild(b);
    }
  }

  function pintarResumen(d) {
    var k = d.kpis, kc = limpiar($('kpis'));
    kc.appendChild(kpi('Ventas registradas', num(k.ventas), 'todas las ventas'));
    kc.appendChild(kpi('Recaudado', pesos(k.recaudado), 'pagadas y liquidadas'));
    kc.appendChild(kpi('Por cobrar', pesos(k.por_cobrar), 'pendientes de pago'));
    kc.appendChild(kpi('Ticket promedio', pesos(k.ticket), 'por venta recaudada'));
    kc.appendChild(kpi('En revisión', num(k.en_revision), k.en_revision ? 'necesitan atención' : 'todo en orden', k.en_revision > 0));
    barras($('g-estado'), d.ventas_por_estado, { monto: true });
    graficoDias($('g-dia'), d.ventas_por_dia);
    tabla($('t-revision'), [
      { k: 'venta_id', t: 'Venta', mono: true }, { k: 'orden_id', t: 'Orden', mono: true }, { k: 'pagador', t: 'Pagador' },
      { k: 'total_a_pagar', t: 'Total', n: true, f: pesos }, { k: 'motivo', t: 'Motivo' }, { k: 'creada_en', t: 'Fecha', f: fecha }
    ], d.en_revision, function (f) { abrirVenta(f.venta_id); });

    var c = d.contabilidad, conc = limpiar($('conciliacion'));
    var problemas = c.descuadradas.length + c.liquidadas_sin_asientos + c.liquidadas_sin_dispersion;
    conc.appendChild(el('div', problemas ? 'estado-mal' : 'estado-ok', problemas
      ? 'Conciliación con diferencias: ' + c.descuadradas.length + ' venta(s) con asientos descuadrados, ' + c.liquidadas_sin_asientos + ' liquidada(s) sin asientos y ' + c.liquidadas_sin_dispersion + ' sin dispersión.'
      : 'Conciliación al día: todos los asientos cuadran (débito = crédito) y cada venta liquidada tiene asientos y dispersión.'));
    tabla($('t-disp'), [
      { k: 'beneficiario', t: 'Beneficiario', f: nombre }, { k: 'n', t: 'Ventas', n: true }, { k: 'base', t: 'Base', n: true, f: pesos },
      { k: 'iva', t: 'IVA', n: true, f: pesos }, { k: 'retencion', t: 'Retención', n: true, f: pesos },
      { k: 'comision', t: 'Comisión + IVA', n: true, f: pesos }, { k: 'neto', t: 'Neto a pagar', n: true, f: pesos }
    ], c.dispersiones);
    tabla($('t-cuentas'), [
      { k: 'cuenta', t: 'Cuenta', mono: true }, { k: 'nombre_cuenta', t: 'Nombre' },
      { k: 'debito', t: 'Débito', n: true, f: pesos }, { k: 'credito', t: 'Crédito', n: true, f: pesos }
    ], c.cuentas);

    barras($('g-cobros'), d.cobros, { monto: true });
    tabla($('t-eventos'), [
      { k: 'tipo', t: 'Evento', f: function (v) { return v; } }, { k: 'resultado', t: 'Resultado' }, { k: 'n', t: 'Cantidad', n: true }
    ], d.eventos_pasarela);
    barras($('g-riesgo'), d.riesgo.por_nivel, { ms: true });
    barras($('g-fuente'), d.riesgo.por_fuente);

    barras($('g-cot'), d.facturacion.cotizaciones, { monto: true });
    barras($('g-pse'), d.facturacion.pagos_pse, { monto: true });
    tabla($('t-cot'), [
      { k: 'cotizacion_ref', t: 'Cotización', mono: true }, { k: 'taller', t: 'Taller' }, { k: 'cliente', t: 'Cliente' },
      { k: 'estado', t: 'Estado', f: badge }, { k: 'total', t: 'Total', n: true, f: pesos },
      { k: 'venta_id', t: 'Venta', mono: true }, { k: 'creada_en', t: 'Fecha', f: fecha }
    ], d.facturacion.recientes);

    var sel = $('f-estado');
    if (sel.options.length <= 1) {
      ['pendiente_pago', 'pago_rechazado', 'pagada', 'liquidada', 'reembolsada', 'anulada', 'en_revision'].forEach(function (e) {
        var o = el('option', '', nombre(e)); o.value = e; sel.appendChild(o);
      });
    }
  }

  function cargarVentas() {
    var ruta = 'ventas?estado=' + encodeURIComponent($('f-estado').value) + '&q=' + encodeURIComponent($('f-texto').value.trim());
    return api(ruta).then(function (d) {
      tabla($('t-ventas'), [
        { k: 'venta_id', t: 'Venta', mono: true }, { k: 'orden_id', t: 'Orden', mono: true }, { k: 'pagador', t: 'Pagador' },
        { k: 'documento', t: 'Documento', mono: true }, { k: 'estado', t: 'Estado', f: badge },
        { k: 'total_a_pagar', t: 'Total', n: true, f: pesos }, { k: 'creada_en', t: 'Fecha', f: fecha }
      ], d.ventas, function (f) { abrirVenta(f.venta_id); });
    });
  }

  function cargarServicios() {
    return api('servicios').then(function (d) {
      var c = limpiar($('servicios'));
      d.servicios.forEach(function (s) {
        var t = el('div', 'serv'), n = el('div', 'nom');
        n.appendChild(el('span', 'punto' + (s.ok ? '' : ' mal')));
        n.appendChild(el('span', '', s.nombre)); t.appendChild(n);
        t.appendChild(el('div', '', s.detalle + (s.ok && s.ms ? ' · ' + s.ms + ' ms' : '')));
        t.appendChild(el('div', 'u', s.url)); c.appendChild(t);
      });
    });
  }

  function abrirVenta(id) {
    api('ventas/' + encodeURIComponent(id)).then(function (d) {
      var v = d.venta, cu = limpiar($('dlg-cuerpo'));
      $('dlg-titulo').textContent = 'Venta ' + v.venta_id;
      limpiar($('dlg-estado')).appendChild(badge(v.estado));
      var g = el('div', 'grid2');
      [['Orden', v.orden_id], ['Pagador', (v.pagador && v.pagador.nombre) + ' (' + (v.pagador && v.pagador.documento) + ')'],
       ['Creada', fecha(v.creada_en)], ['Subtotal', pesos(v.subtotal)], ['IVA', pesos(v.iva)], ['Retenciones', pesos(v.retenciones)],
       ['Total', pesos(v.total)], ['Total a pagar', pesos(v.total_a_pagar)], ['Liquidada', v.liquidada ? 'Sí' : 'No'],
       ['Cobro', v.cobro_id || '—'], ['Motivo', v.motivo || '—']].forEach(function (p) {
        var x = el('div'); x.appendChild(el('span', '', p[0])); x.appendChild(document.createTextNode(String(p[1]))); g.appendChild(x);
      });
      cu.appendChild(g);
      if (v.url_pago) { var a = el('a', '', 'Abrir enlace de pago'); a.href = v.url_pago; a.target = '_blank'; a.rel = 'noopener'; a.style.color = 'var(--acento)'; cu.appendChild(el('h4', '', 'Enlace de pago')).appendChild(document.createTextNode(' ')); cu.lastChild.appendChild(a); }
      if (d.riesgo) {
        cu.appendChild(el('h4', '', 'Decisión de riesgo'));
        var r = el('div'); r.appendChild(badge(d.riesgo.nivel_riesgo));
        r.appendChild(document.createTextNode('  ' + (d.riesgo.motivos || []).join(' · ') + '  (' + d.riesgo.fuente + ', ' + d.riesgo.tiempo_ms + ' ms)'));
        cu.appendChild(r);
      }
      function bloque(titulo, cols, filas) { cu.appendChild(el('h4', '', titulo)); var w = el('div', 'scroll'); cu.appendChild(w); tabla(w, cols, filas); }
      bloque('Líneas', [{ k: 'beneficiario', t: 'Beneficiario', f: nombre }, { k: 'concepto', t: 'Concepto', f: nombre }, { k: 'descripcion', t: 'Descripción' },
        { k: 'cantidad', t: 'Cant.', n: true }, { k: 'precio_unitario', t: 'Precio', n: true, f: pesos }, { k: 'iva_porcentaje', t: 'IVA %', n: true }], d.lineas);
      bloque('Cobros', [{ k: 'cobro_id', t: 'Cobro', mono: true }, { k: 'monto', t: 'Monto', n: true, f: pesos }, { k: 'estado', t: 'Estado', f: badge }, { k: 'creado_en', t: 'Fecha', f: fecha }], d.cobros);
      bloque('Dispersión', [{ k: 'beneficiario', t: 'Beneficiario', f: nombre }, { k: 'base', t: 'Base', n: true, f: pesos }, { k: 'iva', t: 'IVA', n: true, f: pesos },
        { k: 'retencion', t: 'Retención', n: true, f: pesos }, { k: 'comision', t: 'Comisión', n: true, f: pesos }, { k: 'neto', t: 'Neto', n: true, f: pesos }, { k: 'estado', t: 'Estado', f: badge }], d.dispersiones);
      bloque('Asientos contables', [{ k: 'cuenta', t: 'Cuenta', mono: true }, { k: 'nombre_cuenta', t: 'Nombre' }, { k: 'tercero', t: 'Tercero' },
        { k: 'debito', t: 'Débito', n: true, f: pesos }, { k: 'credito', t: 'Crédito', n: true, f: pesos }], d.asientos);
      $('dlg').showModal();
    }).catch(function (e) { alert('No se pudo cargar la venta: ' + e.message); });
  }

  function refrescar() {
    var tareas = [api('resumen').then(function (d) { pintarResumen(d); pintarAvisos(d.avisos); })];
    if (actual === 'ventas') tareas.push(cargarVentas());
    if (actual === 'servicios') tareas.push(cargarServicios());
    return Promise.all(tareas).then(function () {
      $('punto').className = 'punto'; $('actualizado').textContent = 'actualizado ' + new Date().toLocaleTimeString('es-CO');
    }).catch(function (e) {
      $('punto').className = 'punto mal'; $('actualizado').textContent = 'error: ' + e.message;
    });
  }

  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      actual = b.getAttribute('data-t');
      document.querySelectorAll('#tabs button').forEach(function (x) { x.classList.toggle('act', x === b); });
      document.querySelectorAll('main section').forEach(function (s) { s.classList.toggle('act', s.id === 's-' + actual); });
      refrescar();
    });
  });
  $('refrescar').addEventListener('click', refrescar);
  $('f-buscar').addEventListener('click', cargarVentas);
  $('f-estado').addEventListener('change', cargarVentas);
  $('f-texto').addEventListener('keydown', function (e) { if (e.key === 'Enter') cargarVentas(); });
  $('dlg-cerrar').addEventListener('click', function () { $('dlg').close(); });
  $('dlg').addEventListener('click', function (e) { if (e.target === $('dlg')) $('dlg').close(); });
  setInterval(function () { if ($('auto').checked && !$('dlg').open) refrescar(); }, 15000);
  refrescar();
})();
</script>
</body>
</html>`;
