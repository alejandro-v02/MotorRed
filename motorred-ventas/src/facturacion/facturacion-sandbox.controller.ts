import { Body, Controller, Get, HttpException, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { FacturacionService } from './facturacion.service.js';

// Rutas de laboratorio para simular lo que todavía no tenemos integrado de verdad: la respuesta
// del cliente por Telegram y la confirmación del pago PSE (ver ADR 0003). Equivalente a las
// rutas /sandbox/... del kit para la pasarela simulada.
@Controller('facturacion/sandbox')
export class FacturacionSandboxController {
  constructor(private readonly facturacion: FacturacionService) {}

  // Reenvía el aviso de una cotización ya guardada (ver FacturacionService.reenviarAvisoCotizacion).
  @Post('telegram/:cotizacion_ref/reenviar')
  async reenviarAviso(@Param('cotizacion_ref') cotizacion_ref: string) {
    try {
      return await this.facturacion.reenviarAvisoCotizacion(cotizacion_ref);
    } catch (e) {
      throw new HttpException({ error: (e as Error).message }, 400);
    }
  }

  @Post('telegram/:cotizacion_ref/responder')
  async responderTelegram(@Param('cotizacion_ref') cotizacion_ref: string, @Body() body: { aceptada: boolean; motivo?: string }) {
    try {
      await this.facturacion.clienteRespondioCotizacion(cotizacion_ref, body.aceptada, body.motivo);
      return { ok: true };
    } catch (e) {
      throw new HttpException({ error: (e as Error).message }, 400);
    }
  }

  // Enlaces viejos (ya enviados): la pasarela ahora vive en /pagos/<referencia> (ver PagosController).
  @Get('pse/:referencia_pse/pagina')
  redirigir(@Param('referencia_pse') referencia_pse: string, @Res() res: Response) {
    res.redirect(302, `/pagos/${encodeURIComponent(referencia_pse)}`);
  }

  // Reenvía el aviso de pago de una reparación ya terminada (ver FacturacionService.reenviarAvisoPago).
  @Post('pse/:referencia_pse/reenviar')
  async reenviarAvisoPago(@Param('referencia_pse') referencia_pse: string) {
    try {
      return await this.facturacion.reenviarAvisoPago(referencia_pse);
    } catch (e) {
      throw new HttpException({ error: (e as Error).message }, 400);
    }
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
