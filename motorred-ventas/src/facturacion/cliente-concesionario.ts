import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Injectable, Logger } from '@nestjs/common';
import { CONCESIONARIO_MCP } from '../config.js';
import { registrarSaliente } from '../panel/registro.js';

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface NotificarClienteArgs {
  id_relacion: string;
  codigo: string;
  tipo: 'cotizacion' | 'pago';
  cotizacion_ref: string;
  texto: string;
  // "texto" (por defecto) o "html": con html AutoMax envía con parse_mode HTML y solo acepta <b> e <i>.
  formato?: 'texto' | 'html';
  total?: number;
  enlace_pago?: string;
  id_mensaje: string;
}
export interface RespuestaNotificarCliente {
  enviado: boolean;
  canal?: string;
  id_aviso?: number;
  motivo?: 'sin_telegram' | 'telegram_apagado' | 'telegram_fallo' | string;
  detalle?: string;
  cotizacion_ref?: string;
}

// Cliente MCP hacia AutoMax (herramienta notificar_cliente). Bearer amx_… con permiso "facturacion".
@Injectable()
export class ClienteConcesionario {
  private readonly logger = new Logger(ClienteConcesionario.name);
  private mcp: Client | null = null;

  get configurado(): boolean {
    return Boolean(CONCESIONARIO_MCP.url && CONCESIONARIO_MCP.token);
  }

  private async conectar(): Promise<Client> {
    if (this.mcp) return this.mcp;
    const transporte = new StreamableHTTPClientTransport(new URL(CONCESIONARIO_MCP.url), {
      requestInit: { headers: { Authorization: `Bearer ${CONCESIONARIO_MCP.token}` } },
    });
    const mcp = new Client({ name: 'facturacion-cliente-concesionario', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } } as never);
    // Sin límite, una IP que no responde deja el intento colgado y sin rastro en el panel.
    await mcp.connect(transporte, { timeout: 8_000 });
    this.mcp = mcp;
    return mcp;
  }

  // Un reintento reusa el mismo id_mensaje: AutoMax responde lo mismo SIN volver a escribirle al cliente.
  async notificarCliente(args: NotificarClienteArgs, reintentos = 2): Promise<RespuestaNotificarCliente> {
    for (let intento = 0; ; intento++) {
      try {
        const r = await registrarSaliente(
          { canal: 'concesionario', resumen: `notificar_cliente ${args.tipo} ${args.codigo}${intento ? ` (reintento ${intento})` : ''}`, metodo: 'MCP', ruta: CONCESIONARIO_MCP.url, peticion: args },
          async () => {
            const mcp = await this.conectar(); // la conexión también queda registrada si falla
            return (await mcp.callTool({ name: 'notificar_cliente', arguments: { ...args } }, { timeout: CONCESIONARIO_MCP.timeoutMs })) as { isError?: boolean; structuredContent?: unknown; content?: { text?: string }[] };
          },
          (x) => ({ ok: !x.isError, respuesta: x.structuredContent ?? x.content?.[0]?.text }),
        );
        const texto = r.content?.[0]?.text ?? '{}';
        // isError = argumentos inválidos (mensaje en español): reintentar no sirve.
        if (r.isError) throw Object.assign(new Error(`AutoMax rechazó notificar_cliente: ${texto}`), { sinReintento: true });
        return (r.structuredContent ?? JSON.parse(texto)) as RespuestaNotificarCliente;
      } catch (e) {
        this.mcp = null;
        if ((e as { sinReintento?: boolean }).sinReintento || intento >= reintentos) throw e instanceof Error ? e : new Error(String(e));
        this.logger.warn(`notificar_cliente falló (${(e as Error).message}); reintento ${intento + 1}`);
        await pausa(500 * 2 ** intento);
      }
    }
  }
}
