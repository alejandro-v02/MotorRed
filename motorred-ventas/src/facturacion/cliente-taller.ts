import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Injectable } from '@nestjs/common';
import { TALLER_REAL } from '../config.js';

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Cliente MCP hacia el taller REAL. A diferencia de ClienteServicio (contrato del kit, OAuth
// client_credentials), el taller real usa un token fijo compartido (MCP_TALLER_TOKEN) — el mismo
// patrón MCP_<DESTINO>_TOKEN que ellos usan para llamarnos a nosotros. Ver ADR 0003.
@Injectable()
export class ClienteTallerReal {
  private mcp: Client | null = null;

  private async conectar(): Promise<Client> {
    if (this.mcp) return this.mcp;
    const transporte = new StreamableHTTPClientTransport(new URL(`${TALLER_REAL.url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${TALLER_REAL.token}` } },
    });
    const mcp = new Client({ name: 'facturacion-cliente-taller', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } } as never);
    await mcp.connect(transporte);
    this.mcp = mcp;
    return mcp;
  }

  async llamar<T = Record<string, unknown>>(nombre: string, args: Record<string, unknown>, reintentos = 3): Promise<T> {
    for (let intento = 0; ; intento++) {
      try {
        const mcp = await this.conectar();
        const r = (await mcp.callTool({ name: nombre, arguments: args })) as { isError?: boolean; structuredContent?: unknown; content?: { text?: string }[] };
        const texto = r.content?.[0]?.text ?? '{}';
        if (!r.isError) return (r.structuredContent ?? JSON.parse(texto)) as T;
        throw new Error(`El taller rechazó ${nombre}: ${texto}`);
      } catch (e) {
        this.mcp = null;
        if (intento >= reintentos) throw e instanceof Error ? e : new Error(String(e));
        await pausa(300 * 2 ** intento);
      }
    }
  }
}
