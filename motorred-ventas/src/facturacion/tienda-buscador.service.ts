import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { REPUESTOS_MCP } from '../config.js';
import { registrarSaliente } from '../panel/registro.js';

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ respuesta de su agente ----
// Formato verificado contra el MCP real (hablar_con_repuestos). Todo lo que viene de otro agente
// se valida antes de usarlo: termina en precios, cantidades y cobros.

const OfertaDatos = z.object({
  codigo_repuesto: z.string(),
  cantidad: z.number().optional(),
  tienda: z.string().default('Tienda de repuestos'),
  precio_unitario: z.number().nonnegative(), // en pesos, SIN IVA
  iva_porcentaje: z.number().optional(),
  disponible: z.boolean().optional(),
  unidades_disponibles: z.number().optional(),
  repuesto: z.object({ sku: z.string().optional(), nombre: z.string().optional() }).passthrough().optional(),
});

const PedidoRepuestos = z
  .object({
    codigo_orden: z.string().optional(),
    estado: z.string(),
    lineas: z
      .array(
        z.object({
          codigo_repuesto: z.string(),
          cantidad_apartada: z.number().default(0),
          cantidad_entregada: z.number().default(0),
          precio_unitario: z.number().optional(),
        }).passthrough(),
      )
      .default([]),
    ventas: z.array(z.unknown()).default([]),
    total_a_cobrar_con_iva: z.number().default(0),
    total_a_cobrar_sin_iva: z.number().default(0),
    referencia_pago: z.string().nullable().default(null),
  })
  .passthrough();

const RespuestaAgente = z
  .object({
    conversacion_id: z.string().optional(),
    respuesta: z.string().default(''),
    datos: z.array(OfertaDatos).default([]),
    pedido: PedidoRepuestos.nullish(),
  })
  .passthrough();

export type PedidoT = z.infer<typeof PedidoRepuestos>;
export type OfertaDatosT = z.infer<typeof OfertaDatos>;
export type RespuestaAgenteT = z.infer<typeof RespuestaAgente>;
export interface OfertaRepuesto {
  codigo_repuesto: string;
  sku: string;
  tienda: string;
  precio_unitario: number; // sin IVA
  disponible: number;
}
export interface LineaPedido {
  codigo_repuesto: string;
  cantidad: number;
}

// Cliente del agente de repuestos (ver docs/contratos-reales/mcp-repuestos.md). Un solo punto de
// entrada, hablar_con_repuestos, para todo el ciclo de un pedido. QUÉ decir y cuándo lo decide el
// agente de facturación (AgenteFacturacionService); este servicio solo transporta el mensaje.
// Cada intención lleva codigo_orden y un id_mensaje determinista: si se reintenta, se repite el
// mismo id_mensaje y su agente no duplica nada.
@Injectable()
export class TiendaBuscadorService {
  private readonly logger = new Logger(TiendaBuscadorService.name);
  private mcp: Client | null = null;

  private async conectar(): Promise<Client> {
    if (this.mcp) return this.mcp;
    const transporte = new StreamableHTTPClientTransport(new URL(REPUESTOS_MCP.url), {
      requestInit: { headers: { Authorization: `Bearer ${REPUESTOS_MCP.token}` } },
    });
    const mcp = new Client({ name: 'facturacion-cliente-repuestos', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } } as never);
    await mcp.connect(transporte);
    this.mcp = mcp;
    return mcp;
  }

  // Habla con el agente de repuestos. Reintenta ante fallos de red repitiendo el MISMO id_mensaje.
  async hablarConRepuestos(mensaje: string, codigo_orden: string, id_mensaje: string, reintentos = 2): Promise<RespuestaAgenteT> {
    for (let intento = 0; ; intento++) {
      try {
        const mcp = await this.conectar();
        const r = await registrarSaliente(
          {
            canal: 'tienda',
            resumen: `hablar_con_repuestos · ${mensaje.slice(0, 70)}${intento ? ` (reintento ${intento})` : ''}`,
            metodo: 'MCP',
            ruta: REPUESTOS_MCP.url,
            peticion: { mensaje, codigo_orden, id_mensaje },
          },
          () =>
            mcp.callTool(
              { name: 'hablar_con_repuestos', arguments: { mensaje, codigo_orden, id_mensaje } },
              { timeout: REPUESTOS_MCP.timeoutMs },
            ) as Promise<{ isError?: boolean; content?: { text?: string }[] }>,
          (x) => ({ ok: !x.isError, respuesta: this.leerTexto(x) }),
        );
        const texto = r.content?.[0]?.text ?? '{}';
        if (r.isError) throw new Error(`El agente de repuestos rechazó el mensaje: ${texto}`);
        return RespuestaAgente.parse(JSON.parse(texto));
      } catch (e) {
        this.mcp = null;
        if (intento >= reintentos) throw e instanceof Error ? e : new Error(String(e));
        await pausa(500 * 2 ** intento);
      }
    }
  }

  private leerTexto(x: { content?: { text?: string }[] }): unknown {
    const t = x.content?.[0]?.text;
    if (!t) return undefined;
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }

  // Convierte datos[] de la cotización en ofertas por codigo_repuesto. Lanza si falta alguno de los
  // repuestos pedidos: sin precio no se puede cotizar.
  ofertasDesdeDatos(lineas: LineaPedido[], datos: Iterable<OfertaDatosT>, respuesta = ''): Map<string, OfertaRepuesto> {
    const lista = [...datos];
    const ofertas = new Map<string, OfertaRepuesto>();
    for (const l of lineas) {
      const d = lista.find((x) => x.codigo_repuesto.toUpperCase() === l.codigo_repuesto.toUpperCase());
      if (!d) throw new Error(`El agente de repuestos no cotizó "${l.codigo_repuesto}". Respuesta: ${respuesta.slice(0, 200)}`);
      const disponible = d.unidades_disponibles ?? (d.disponible ? l.cantidad : 0);
      if (disponible < l.cantidad) {
        this.logger.warn(`Solo hay ${disponible} unidad(es) disponible(s) de ${l.codigo_repuesto}, se está cotizando ${l.cantidad}`);
      }
      ofertas.set(l.codigo_repuesto, {
        codigo_repuesto: l.codigo_repuesto,
        sku: d.repuesto?.sku ?? l.codigo_repuesto,
        tienda: d.tienda,
        precio_unitario: d.precio_unitario,
        disponible,
      });
    }
    return ofertas;
  }

  async cancelar(codigo_orden: string, id_mensaje: string): Promise<PedidoT | null> {
    const r = await this.hablarConRepuestos('Cancela el pedido', codigo_orden, id_mensaje);
    return r.pedido ?? null;
  }
}

export const listaTexto = (lineas: LineaPedido[]): string => lineas.map((l) => `${l.cantidad} ${l.codigo_repuesto}`).join(' y ');
