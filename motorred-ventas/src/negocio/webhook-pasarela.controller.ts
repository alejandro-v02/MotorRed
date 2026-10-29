import { Controller, Headers, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { VentasService } from './ventas.service.js';

// POST /webhooks/pasarela — ruta del contrato (no es una herramienta MCP). Usa el cuerpo CRUDO
// (req.rawBody, habilitado en main.ts) porque la firma HMAC se calcula sobre el texto exacto.
@Controller('webhooks/pasarela')
export class WebhookPasarelaController {
  constructor(private readonly ventas: VentasService) {}

  @Post()
  @HttpCode(200)
  async recibir(@Req() req: Request & { rawBody?: Buffer }, @Res() res: Response, @Headers('x-pasarela-firma') firma: string | undefined) {
    const cuerpo = (req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}))).toString('utf8');
    const { status, body } = await this.ventas.manejarWebhookPasarela(cuerpo, firma);
    res.status(status).json(body);
  }
}
