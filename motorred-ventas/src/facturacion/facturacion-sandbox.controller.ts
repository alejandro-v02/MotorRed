import { Body, Controller, Get, HttpException, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { FacturacionService } from './facturacion.service.js';

// Rutas de laboratorio para simular lo que todavía no tenemos integrado de verdad: la respuesta
// del cliente por Telegram y la confirmación del pago PSE (ver ADR 0003). Equivalente a las
// rutas /sandbox/... del kit para la pasarela simulada.
@Controller('facturacion/sandbox')
export class FacturacionSandboxController {
  constructor(private readonly facturacion: FacturacionService) {}

  @Post('telegram/:cotizacion_ref/responder')
  async responderTelegram(@Param('cotizacion_ref') cotizacion_ref: string, @Body() body: { aceptada: boolean; motivo?: string }) {
    try {
      await this.facturacion.clienteRespondioCotizacion(cotizacion_ref, body.aceptada, body.motivo);
      return { ok: true };
    } catch (e) {
      throw new HttpException({ error: (e as Error).message }, 400);
    }
  }

  @Get('pse/:referencia_pse/pagina')
  verPagina(@Param('referencia_pse') referencia_pse: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>PSE simulado</title></head>
<body style="font-family:system-ui;max-width:420px;margin:40px auto">
<p style="background:#fff4d6;padding:8px;border-radius:6px">PSE SIMULADO para clase. No hay pasarela real.</p>
<h1>Referencia ${referencia_pse}</h1>
<form method="post" action="/facturacion/sandbox/pse/${referencia_pse}/confirmar" onsubmit="event.preventDefault();fetch(this.action,{method:'POST'}).then(()=>document.body.innerHTML='<p>Pago confirmado.</p>')">
<button type="submit">Pagar (confirmar)</button>
</form></body></html>`);
  }

  @Post('pse/:referencia_pse/confirmar')
  async confirmarPse(@Param('referencia_pse') referencia_pse: string) {
    try {
      await this.facturacion.confirmarPago(referencia_pse);
      return { ok: true };
    } catch (e) {
      throw new HttpException({ error: (e as Error).message }, 400);
    }
  }
}
