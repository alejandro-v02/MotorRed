import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, Delete, Get, Headers, HttpException, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GRUPO, RAIZ } from '../config.js';
import { BitacoraService } from '../mcp/bitacora.service.js';
import { registroPanel } from './registro.js';

// Panel visual de logs: GET /panel. Muestra peticiones entrantes (MCP, facturación, webhooks),
// llamadas salientes (n8n/Telegram, taller, tienda) y la bitácora de negocio.
// Si PANEL_TOKEN está definido en .env, hay que abrir /panel?token=... (por defecto es libre: es
// un servicio de laboratorio, pero los cuerpos incluyen datos de clientes).
@Controller('panel')
export class PanelController {
  constructor(private readonly bitacora: BitacoraService) {}

  private verificar(token?: string, autorizacion?: string) {
    const esperado = process.env.PANEL_TOKEN;
    if (!esperado) return;
    if (token !== esperado && autorizacion !== `Bearer ${esperado}`) {
      throw new HttpException({ error: 'Falta o es inválido el token del panel (?token=...)' }, 401);
    }
  }

  @Get()
  pagina(@Res() res: Response, @Query('token') token?: string) {
    this.verificar(token);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(readFileSync(join(RAIZ, 'src', 'panel', 'panel.html'), 'utf8').replace('__SERVICIO__', GRUPO));
  }

  @Get('api/logs')
  logs(@Query('desde') desde?: string, @Query('token') token?: string, @Headers('authorization') aut?: string) {
    this.verificar(token, aut);
    const entradas = registroPanel.listar(Number(desde) || 0);
    return {
      servicio: GRUPO,
      entradas,
      ultimo_id: entradas.length ? entradas[entradas.length - 1].id : Number(desde) || 0,
    };
  }

  @Get('api/bitacora')
  bitacoraNegocio(@Query('token') token?: string, @Headers('authorization') aut?: string) {
    this.verificar(token, aut);
    return { servicio: GRUPO, registros: this.bitacora.consultar().slice(-500).reverse() };
  }

  @Delete('api/logs')
  limpiar(@Query('token') token?: string, @Headers('authorization') aut?: string) {
    this.verificar(token, aut);
    registroPanel.limpiar();
    return { ok: true };
  }
}
