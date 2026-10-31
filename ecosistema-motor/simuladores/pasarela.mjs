// Pasarela de pagos SIMULADA (no mueve dinero real). Imita a una pasarela comercial: cobros con
// enlace de pago, página de pago de prueba, reembolsos y webhooks firmados con reintentos.
// Con PASARELA_DUPLICAR=1 envía cada evento dos veces, como hacen las pasarelas reales a veces:
// el receptor debe ser idempotente.   node simuladores/pasarela.mjs
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FIRMA, PASARELA_DUPLICAR, PASARELA_LLAVE, PASARELA_URL_PUBLICA, PUERTOS } from '../lib/config.mjs';
import { enviarEvento } from '../lib/eventos.mjs';
import { crearBitacora, leerCuerpo, responder } from '../lib/servicio.mjs';

const pesos = (v) => '$' + v.toLocaleString('es-CO');
const escapar = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function iniciar(puerto = PUERTOS.pasarela) {
  const cobros = new Map();
  const bitacora = crearBitacora('pasarela');
  let n = 0;

  async function notificar(cobro, tipo) {
    const evento = { evento_id: `EVP-${randomUUID()}`, tipo, cobro_id: cobro.cobro_id, referencia: cobro.referencia, monto: cobro.monto, fecha: new Date().toISOString() };
    const veces = PASARELA_DUPLICAR ? 2 : 1;
    for (let i = 0; i < veces; i++) await enviarEvento(cobro.url_webhook, evento, FIRMA.pasarela, { cabecera: 'X-Pasarela-Firma', bitacora });
  }

  async function resolver(cobro, resultado) {
    if (cobro.estado !== 'pendiente') return false;
    cobro.estado = resultado === 'aprobado' ? 'aprobado' : 'rechazado';
    cobro.resuelto_en = new Date().toISOString();
    bitacora({ evento: `cobro ${cobro.estado}`, cobro_id: cobro.cobro_id, referencia: cobro.referencia, monto: cobro.monto });
    await notificar(cobro, cobro.estado === 'aprobado' ? 'cobro.aprobado' : 'cobro.rechazado');
    return true;
  }

  const autorizado = (req) => req.headers.authorization === `Bearer ${PASARELA_LLAVE}`;
  // Página de pago estilo checkout comercial. Sin JavaScript (la CSP lo bloquea): las pestañas de
  // método de pago son radios + CSS. Los campos de tarjeta no tienen `name`, así que no viajan:
  // el servidor solo lee `resultado`.
  const ESTILOS = `
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1a1f36;background:#fff;-webkit-font-smoothing:antialiased}
.app{display:grid;grid-template-columns:1fr 1fr;min-height:100vh}
.resumen{background:linear-gradient(160deg,#1f2a5a 0%,#3b3f9e 55%,#635bff 100%);color:#fff;padding:56px 48px 40px 0;display:flex;justify-content:flex-end}
.resumen>div{width:100%;max-width:400px;margin-left:24px}
.marca{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px;opacity:.95}
.marca i{width:28px;height:28px;border-radius:8px;background:#fff;color:#3b3f9e;display:grid;place-items:center;font-style:normal;font-weight:800;font-size:14px}
.etiqueta{margin-top:40px;font-size:14px;opacity:.75}
.monto{font-size:40px;font-weight:700;letter-spacing:-.02em;margin:4px 0 0}
.detalle{margin-top:36px;border-top:1px solid rgba(255,255,255,.18);padding-top:20px;font-size:14px}
.detalle div{display:flex;justify-content:space-between;gap:16px;padding:7px 0}.detalle span:first-child{opacity:.72}.detalle span:last-child{text-align:right;word-break:break-word}
.detalle .total{border-top:1px solid rgba(255,255,255,.18);margin-top:10px;padding-top:14px;font-weight:600;font-size:15px}
.pie{margin-top:48px;font-size:12px;opacity:.6}
.pago{padding:56px 0 40px 48px;display:flex}.pago>div{width:100%;max-width:400px;margin-right:24px}
h2{font-size:18px;margin:0 0 20px}
.aviso{display:flex;gap:8px;align-items:flex-start;background:#fff8e1;border:1px solid #ffe08a;color:#7a5b00;border-radius:8px;padding:10px 12px;font-size:12.5px;line-height:1.4;margin-bottom:22px}
.metodos{display:flex;gap:8px;margin-bottom:22px}
.metodos label{flex:1;text-align:center;padding:11px 6px;border:1px solid #d5dbe6;border-radius:8px;font-size:13.5px;font-weight:500;cursor:pointer;color:#4f566b;transition:.15s}
.metodos label:hover{border-color:#aab3c5}
input[type=radio]{position:absolute;opacity:0;pointer-events:none}
#m1:checked~.metodos [for=m1],#m2:checked~.metodos [for=m2],#m3:checked~.metodos [for=m3]{border-color:#635bff;color:#4b43d9;background:#f4f3ff;box-shadow:0 0 0 1px #635bff}
.panel{display:none}#m1:checked~#p1,#m2:checked~#p2,#m3:checked~#p3{display:block}
.campo{margin-bottom:14px}.campo label{display:block;font-size:13px;font-weight:500;color:#4f566b;margin-bottom:6px}
.campo input,.campo select{width:100%;padding:11px 12px;font-size:15px;color:#1a1f36;background:#fff;border:1px solid #d5dbe6;border-radius:8px;outline:0;transition:.15s;font-family:inherit}
.campo input:focus,.campo select:focus{border-color:#635bff;box-shadow:0 0 0 3px rgba(99,91,255,.18)}
.fila{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.pagar{width:100%;margin-top:8px;padding:14px;font-size:16px;font-weight:600;color:#fff;background:#635bff;border:0;border-radius:8px;cursor:pointer;transition:.15s;box-shadow:0 1px 2px rgba(0,0,0,.1)}
.pagar:hover{background:#544bf0}.pagar:active{transform:translateY(1px)}
.rechazar{display:block;width:100%;margin-top:12px;padding:8px;font-size:13px;color:#697386;background:none;border:0;cursor:pointer;text-decoration:underline;font-family:inherit}
.rechazar:hover{color:#b3261e}
.seguro{margin-top:20px;text-align:center;font-size:12px;color:#8792a2}
.resultado{text-align:center;padding-top:30px}
.icono{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;margin:0 auto 20px;font-size:32px;color:#fff;font-weight:700}
.ok .icono{background:#30b566}.mal .icono{background:#e5484d}.rev .icono{background:#8792a2}
.resultado h2{font-size:22px;margin-bottom:8px}.resultado p{color:#697386;font-size:14.5px;line-height:1.5;margin:0 0 6px}
.ref{display:inline-block;margin-top:16px;padding:6px 12px;background:#f6f8fa;border-radius:6px;font-family:ui-monospace,Consolas,monospace;font-size:12.5px;color:#4f566b}
@media(max-width:760px){.app{grid-template-columns:1fr}.resumen{padding:28px 20px;justify-content:flex-start}.resumen>div{margin:0;max-width:none}
.etiqueta{margin-top:22px}.monto{font-size:32px}.detalle{margin-top:20px}.pie{display:none}.pago{padding:24px 20px}.pago>div{margin:0;max-width:none}}`;

  const ESTADOS = {
    aprobado: { clase: 'ok', icono: '✓', titulo: 'Pago exitoso', texto: 'Recibimos tu pago y el comercio ya fue notificado. Puedes cerrar esta ventana.' },
    rechazado: { clase: 'mal', icono: '✕', titulo: 'Pago rechazado', texto: 'Tu banco no autorizó la transacción. No se realizó ningún cargo. Solicita un nuevo enlace de pago al comercio para intentarlo de nuevo.' },
    reembolsado: { clase: 'rev', icono: '↺', titulo: 'Pago reembolsado', texto: 'Este cobro fue reembolsado. El dinero volverá a tu medio de pago en los próximos días hábiles.' },
  };

  const pagina = (cobro, mensaje = '') => {
    const monto = pesos(cobro.monto);
    const fecha = new Date(cobro.creado_en).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
    const est = ESTADOS[cobro.estado];
    const derecha = est
      ? `<div class="resultado ${est.clase}"><div class="icono">${est.icono}</div><h2>${est.titulo}</h2><p>${est.texto}</p>${mensaje ? `<p><strong>${escapar(mensaje)}</strong></p>` : ''}<span class="ref">${escapar(cobro.cobro_id)} · ${escapar(cobro.referencia)}</span></div>`
      : `<h2>Pagar con</h2>
<div class="aviso"><span>⚠</span><span>Pasarela <strong>simulada</strong> para clase. No ingrese datos de tarjetas reales; no se mueve dinero.</span></div>
<form method="post">
<input type="radio" id="m1" name="metodo" value="tarjeta" checked><input type="radio" id="m2" name="metodo" value="pse"><input type="radio" id="m3" name="metodo" value="nequi">
<div class="metodos"><label for="m1">Tarjeta</label><label for="m2">PSE</label><label for="m3">Nequi</label></div>
<div class="panel" id="p1">
<div class="campo"><label>Número de tarjeta</label><input value="4242 4242 4242 4242" inputmode="numeric" autocomplete="off"></div>
<div class="fila"><div class="campo"><label>Vencimiento</label><input value="12 / 30" autocomplete="off"></div><div class="campo"><label>CVC</label><input value="123" autocomplete="off"></div></div>
<div class="campo"><label>Nombre en la tarjeta</label><input value="Cliente de Prueba" autocomplete="off"></div>
</div>
<div class="panel" id="p2">
<div class="campo"><label>Banco</label><select><option>Banco de Prueba</option><option>Bancolombia</option><option>Davivienda</option><option>Banco de Bogotá</option></select></div>
<div class="campo"><label>Tipo de persona</label><select><option>Persona natural</option><option>Persona jurídica</option></select></div>
<div class="campo"><label>Correo electrónico</label><input value="cliente@prueba.co" autocomplete="off"></div>
</div>
<div class="panel" id="p3">
<div class="campo"><label>Número de celular Nequi</label><input value="300 123 4567" inputmode="tel" autocomplete="off"></div>
<p style="font-size:13px;color:#697386;margin:0 0 6px">Recibirás una notificación en tu app para aprobar el pago.</p>
</div>
<button class="pagar" name="resultado" value="aprobado">Pagar ${monto}</button>
<button class="rechazar" name="resultado" value="rechazado">Simular pago rechazado</button>
</form>
<div class="seguro">🔒 Pago protegido · Entorno de pruebas</div>`;
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pagar ${monto} · MotorRed</title><style>${ESTILOS}</style></head><body><div class="app">
<aside class="resumen"><div>
<div class="marca"><i>M</i>MotorRed</div>
<div class="etiqueta">Total a pagar</div><div class="monto">${monto}</div>
<div class="detalle"><div><span>Concepto</span><span>${escapar(cobro.descripcion)}</span></div><div><span>Referencia</span><span>${escapar(cobro.referencia)}</span></div><div><span>Cobro</span><span>${escapar(cobro.cobro_id)}</span></div><div><span>Fecha</span><span>${escapar(fecha)}</span></div><div class="total"><span>Total</span><span>${monto} COP</span></div></div>
<div class="pie">Pasarela de pagos de prueba · MotorRed</div>
</div></aside>
<main class="pago"><div>${derecha}</div></main>
</div></body></html>`;
  };

  const servidor = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const partes = url.pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && url.pathname === '/salud') return responder(res, 200, { servicio: 'pasarela', estado: 'ok' });
      if (req.method === 'POST' && url.pathname === '/api/cobros') {
        if (!autorizado(req)) return responder(res, 401, { error: 'Llave de API inválida' });
        const d = JSON.parse(await leerCuerpo(req));
        if (!Number.isInteger(d.monto) || d.monto <= 0 || !d.referencia || !d.url_webhook) return responder(res, 400, { error: 'monto, referencia y url_webhook son obligatorios' });
        const cobro = { cobro_id: `CB-${String(++n).padStart(6, '0')}`, referencia: d.referencia, monto: d.monto, descripcion: d.descripcion ?? d.referencia, url_webhook: d.url_webhook, estado: 'pendiente', creado_en: new Date().toISOString() };
        cobro.url_checkout = `${PASARELA_URL_PUBLICA}/checkout/${cobro.cobro_id}`;
        cobros.set(cobro.cobro_id, cobro);
        bitacora({ evento: 'cobro creado', cobro_id: cobro.cobro_id, referencia: cobro.referencia, monto: cobro.monto });
        return responder(res, 201, cobro);
      }
      if (req.method === 'GET' && url.pathname === '/api/bitacora') {
        if (!autorizado(req)) return responder(res, 401, { error: 'Llave de API inválida' });
        const referencias = (url.searchParams.get('referencias') ?? '').split(',').filter(Boolean);
        return responder(res, 200, { servicio: 'pasarela', registros: bitacora.consultar().filter((l) => !referencias.length || referencias.includes(l.referencia)) });
      }
      if (partes[0] === 'api' && partes[1] === 'cobros' && partes[2]) {
        if (!autorizado(req)) return responder(res, 401, { error: 'Llave de API inválida' });
        const cobro = cobros.get(partes[2]);
        if (!cobro) return responder(res, 404, { error: 'No existe el cobro' });
        if (req.method === 'GET' && !partes[3]) return responder(res, 200, cobro);
        if (req.method === 'POST' && partes[3] === 'simular') {
          const { resultado } = JSON.parse(await leerCuerpo(req));
          if (!(await resolver(cobro, resultado))) return responder(res, 409, { error: `El cobro ya está ${cobro.estado}` });
          return responder(res, 200, cobro);
        }
        if (req.method === 'POST' && partes[3] === 'reembolso') {
          if (cobro.estado !== 'aprobado') return responder(res, 409, { error: `No se puede reembolsar un cobro ${cobro.estado}` });
          cobro.estado = 'reembolsado';
          bitacora({ evento: 'cobro reembolsado', cobro_id: cobro.cobro_id, referencia: cobro.referencia, monto: cobro.monto });
          notificar(cobro, 'cobro.reembolsado');
          return responder(res, 200, cobro);
        }
      }
      if (partes[0] === 'checkout' && partes[1]) {
        const cobro = cobros.get(partes[1]);
        if (!cobro) return responder(res, 404, { error: 'No existe el cobro' });
        let mensaje = '';
        if (req.method === 'POST') {
          const resultado = new URLSearchParams(await leerCuerpo(req)).get('resultado');
          mensaje = (await resolver(cobro, resultado)) ? 'Gracias. El comercio ya fue notificado.' : 'Este cobro ya fue procesado.';
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" });
        return res.end(pagina(cobro, mensaje));
      }
      responder(res, 404, { error: 'No existe la ruta' });
    } catch (e) {
      console.error('[pasarela]', e);
      if (!res.headersSent) responder(res, 500, { error: 'Error interno' });
    }
  });
  await new Promise((r) => servidor.listen(puerto, r));
  return puerto;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`pasarela en el puerto ${await iniciar()}`);
