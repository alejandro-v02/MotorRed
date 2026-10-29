import { All, Controller, Req, Res } from '@nestjs/common';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import type { Request, Response } from 'express';
import { TALLER_REAL } from '../config.js';
import { Acuse, CrearCotizacionInput, NotificarReparacionTerminadaInput } from './esquemas.js';
import { FacturacionService } from './facturacion.service.js';

// Servidor MCP de la integración con el taller REAL (ver ADR 0003). Separado de /mcp (que sigue
// publicando el contrato del kit) porque es un contrato distinto, con su propia autenticación:
// un token fijo compartido (MCP_FACTURACION_TOKEN), igual al patrón MCP_<DESTINO>_TOKEN que el
// taller ya usa para sus propias llamadas salientes — no el OAuth client_credentials del kit.
@Controller('mcp-facturacion')
export class McpFacturacionController {
  private readonly atender;

  constructor(private readonly facturacion: FacturacionService) {
    const fabrica = () => {
      const servidor = new McpServer({ name: 'motorred-facturacion', version: '1.0-real' });

      servidor.registerTool(
        'crear_cotizacion',
        {
          title: 'Crear cotización',
          description: 'El taller pide cotizar repuestos y mano de obra. Asíncrono: la respuesta real llega luego por registrar_respuesta_cliente en el MCP del taller.',
          inputSchema: CrearCotizacionInput,
          outputSchema: Acuse,
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        async (args: unknown) => {
          const resultado = await this.facturacion.recibirCotizacion(CrearCotizacionInput.parse(args));
          return { content: [{ type: 'text' as const, text: JSON.stringify(resultado) }], structuredContent: resultado };
        },
      );

      servidor.registerTool(
        'notificar_reparacion_terminada',
        {
          title: 'Notificar reparación terminada',
          description: 'El taller avisa que terminó. Asíncrono: la respuesta real llega luego por registrar_pago en el MCP del taller.',
          inputSchema: NotificarReparacionTerminadaInput,
          outputSchema: Acuse,
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        async (args: unknown) => {
          const resultado = await this.facturacion.recibirReparacionTerminada(NotificarReparacionTerminadaInput.parse(args));
          return { content: [{ type: 'text' as const, text: JSON.stringify(resultado) }], structuredContent: resultado };
        },
      );

      return servidor;
    };
    this.atender = toNodeHandler(createMcpHandler(fabrica as never));
  }

  @All()
  async manejar(@Req() req: Request, @Res() res: Response) {
    const [tipo, token] = String(req.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || token !== TALLER_REAL.tokenEntrante) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'Token ausente o inválido' });
      return;
    }
    await this.atender(req as never, res, req.body);
  }
}
