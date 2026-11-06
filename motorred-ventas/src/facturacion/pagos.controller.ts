import { Body, Controller, Get, HttpException, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { comprobantePdf } from './comprobante-pdf.js';
import { FacturacionService } from './facturacion.service.js';

type Pago = NonNullable<Awaited<ReturnType<FacturacionService['datosPago']>>>;

const escapar = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pesos = (v: number) => '$' + v.toLocaleString('es-CO');
const pausa = (ms: number) => new Promise<'tarde'>((r) => setTimeout(() => r('tarde'), ms));

// Pasarela de pago PSE SIMULADA, en /pagos/<referencia_pse>. Imita el checkout de la pasarela del kit
// (ecosistema-motor/simuladores/pasarela.mjs): resumen a la izquierda, métodos de pago a la derecha,
// "Simular pago rechazado" y pantallas de resultado. Sin JavaScript (la CSP lo bloquea): las pestañas
// son radios + CSS y el pago es un formulario. No mueve dinero; al aprobar llama a confirmarPago,
// que liquida y avisa al taller (registrar_pago).
@Controller('pagos')
export class PagosController {
  constructor(private readonly facturacion: FacturacionService) {}

  private enviar(res: Response, estado: number, html: string) {
    res.status(estado)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'")
      .send(html);
  }

  @Get(':referencia_pse')
  async ver(@Param('referencia_pse') referencia_pse: string, @Res() res: Response) {
    const pago = await this.facturacion.datosPago(referencia_pse);
    if (!pago) return this.enviar(res, 404, this.noExiste(referencia_pse));
    this.enviar(res, 200, this.pagina(pago));
  }

  // Formulario de la página: resultado = aprobado | rechazado.
  @Post(':referencia_pse')
  async pagar(@Param('referencia_pse') referencia_pse: string, @Body() body: { resultado?: string }, @Res() res: Response) {
    const antes = await this.facturacion.datosPago(referencia_pse);
    if (!antes) return this.enviar(res, 404, this.noExiste(referencia_pse));
    let mensaje = '';
    if (antes.estado !== 'pendiente') {
      mensaje = 'Este pago ya fue procesado.';
    } else if (body?.resultado === 'rechazado') {
      await this.facturacion.rechazarPago(referencia_pse);
    } else {
      // Confirmar liquida y llama al agente/taller, y eso puede tardar. Si pasan 8 s sin terminar,
      // el cliente ve "recibido" y el proceso sigue en segundo plano (ya quedó registrado en el log).
      const trabajo = this.facturacion.confirmarPago(referencia_pse).then(() => 'listo' as const);
      try {
        const r = await Promise.race([trabajo, pausa(8_000)]);
        if (r === 'tarde') {
          mensaje = 'Estamos terminando de registrar tu pago.';
          trabajo.catch(() => undefined);
        } else {
          mensaje = 'Gracias. El comercio ya fue notificado.';
        }
      } catch (e) {
        mensaje = `No se pudo confirmar el pago: ${(e as Error).message}`;
      }
    }
    const despues = (await this.facturacion.datosPago(referencia_pse)) ?? antes;
    this.enviar(res, 200, this.pagina(despues, mensaje));
  }

  // "Intentar de nuevo" en la pantalla de pago rechazado: reabre el pago y vuelve al formulario.
  @Post(':referencia_pse/reintentar')
  async reintentar(@Param('referencia_pse') referencia_pse: string, @Res() res: Response) {
    await this.facturacion.reabrirPago(referencia_pse);
    res.redirect(303, `/pagos/${encodeURIComponent(referencia_pse)}`);
  }

  // Comprobante en PDF (solo de pagos aprobados). Se descarga como archivo adjunto.
  @Get(':referencia_pse/comprobante')
  async comprobante(@Param('referencia_pse') referencia_pse: string, @Res() res: Response) {
    const datos = await this.facturacion.datosComprobante(referencia_pse);
    if (!datos) {
      this.enviar(res, 404, this.base('Sin comprobante', `<div class="resultado mal"><div class="icono">✕</div><h2>Sin comprobante</h2><p>Solo los pagos aprobados tienen comprobante.</p></div>`, ''));
      return;
    }
    res.status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="comprobante-${referencia_pse.replace(/[^A-Za-z0-9._-]/g, '')}.pdf"`)
      .setHeader('Cache-Control', 'no-store')
      .send(comprobantePdf(datos));
  }

  // Compatibilidad: confirmación directa por API (la usaban las pruebas y n8n).
  @Post(':referencia_pse/confirmar')
  async confirmar(@Param('referencia_pse') referencia_pse: string) {
    try {
      await this.facturacion.confirmarPago(referencia_pse);
      return { ok: true };
    } catch (e) {
      throw new HttpException({ error: (e as Error).message }, 400);
    }
  }

  private noExiste(referencia_pse: string): string {
    return this.base('Pago no encontrado', `<div class="resultado mal"><div class="icono">✕</div><h2>Pago no encontrado</h2><p>No existe el pago <strong>${escapar(referencia_pse)}</strong>. Solicita un enlace nuevo al comercio.</p></div>`, '');
  }

  private pagina(pago: Pago, mensaje = ''): string {
    const monto = pesos(pago.valor);
    const fecha = pago.creado_en.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
    const estados: Record<string, { clase: string; icono: string; titulo: string; texto: string }> = {
      confirmado: { clase: 'ok', icono: '✓', titulo: 'Pago exitoso', texto: 'Recibimos tu pago y el comercio ya fue notificado. Puedes cerrar esta ventana.' },
      rechazado: { clase: 'mal', icono: '✕', titulo: 'Pago rechazado', texto: 'Tu banco no autorizó la transacción. No se realizó ningún cargo. Puedes intentarlo de nuevo con el mismo valor.' },
    };
    const est = estados[pago.estado];
    const derecha = est
      ? `<div class="resultado ${est.clase}"><div class="icono">${est.icono}</div><h2>${est.titulo}</h2><p>${est.texto}</p>${mensaje ? `<p><strong>${escapar(mensaje)}</strong></p>` : ''}${pago.estado === 'rechazado' ? `<form method="post" action="/pagos/${encodeURIComponent(pago.referencia_pse)}/reintentar"><button class="pagar descargar" type="submit">Intentar de nuevo</button></form>` : ''}${pago.estado === 'confirmado' ? `<a class="pagar descargar" href="/pagos/${encodeURIComponent(pago.referencia_pse)}/comprobante" download>⬇ Descargar comprobante</a>` : ''}<span class="ref">${escapar(pago.codigo)} · ${escapar(pago.referencia_pse)}</span></div>`
      : mensaje
        ? `<div class="resultado rev"><div class="icono">…</div><h2>Procesando</h2><p><strong>${escapar(mensaje)}</strong></p><p>Puedes cerrar esta ventana o recargarla en unos segundos.</p><span class="ref">${escapar(pago.codigo)} · ${escapar(pago.referencia_pse)}</span></div>`
        : `<h2>Pagar con</h2>
<div class="aviso"><span>⚠</span><span>Pasarela <strong>simulada</strong> para clase. No ingrese datos de tarjetas reales; no se mueve dinero.</span></div>
<form method="post">
<input type="radio" id="m1" name="metodo" value="tarjeta"><input type="radio" id="m2" name="metodo" value="pse" checked><input type="radio" id="m3" name="metodo" value="nequi">
<div class="metodos"><label for="m1">Tarjeta</label><label for="m2">PSE</label><label for="m3">Nequi</label></div>
<div class="panel" id="p1">
<div class="campo"><label>Número de tarjeta</label><input value="4242 4242 4242 4242" inputmode="numeric" autocomplete="off"></div>
<div class="fila"><div class="campo"><label>Vencimiento</label><input value="12 / 30" autocomplete="off"></div><div class="campo"><label>CVC</label><input value="123" autocomplete="off"></div></div>
<div class="campo"><label>Nombre en la tarjeta</label><input value="${escapar(pago.cliente)}" autocomplete="off"></div>
</div>
<div class="panel" id="p2">
<div class="campo"><label>Banco</label><select><option>Banco de Prueba</option><option>Bancolombia</option><option>Davivienda</option><option>Banco de Bogotá</option><option>BBVA</option><option>Banco de Occidente</option></select></div>
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
    const resumen = `<aside class="resumen"><div>
<div class="marca"><i>M</i>MotorRed</div>
<div class="etiqueta">Total a pagar</div><div class="monto">${monto}</div>
<div class="detalle"><div><span>Concepto</span><span>Reparación · orden ${escapar(pago.codigo)}</span></div><div><span>Cliente</span><span>${escapar(pago.cliente)}</span></div><div><span>Referencia</span><span>${escapar(pago.referencia_pse)}</span></div><div><span>Fecha</span><span>${escapar(fecha)}</span></div><div><span>IVA</span><span>Incluido</span></div><div class="total"><span>Total</span><span>${monto} COP</span></div></div>
<div class="pie">Pasarela de pagos de prueba · MotorRed</div>
</div></aside>`;
    return this.base(`Pagar ${monto} · MotorRed`, derecha, resumen);
  }

  private base(titulo: string, derecha: string, resumen: string): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(titulo)}</title><style>${ESTILOS}</style></head><body><div class="app${resumen ? '' : ' sola'}">
${resumen}
<main class="pago"><div>${derecha}</div></main>
</div></body></html>`;
  }
}

const ESTILOS = `
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1a1f36;background:#fff;-webkit-font-smoothing:antialiased}
.app{display:grid;grid-template-columns:1fr 1fr;min-height:100vh}.app.sola{grid-template-columns:1fr}
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
.sola .pago{justify-content:center;padding:56px 24px}
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
.descargar{display:block;margin:22px 0 0;text-align:center;text-decoration:none}
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
