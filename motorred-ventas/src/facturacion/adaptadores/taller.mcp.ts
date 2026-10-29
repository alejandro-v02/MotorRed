import type { z } from 'zod';
import { FACTURACION } from '../../config.js';
import type { PagoSalida, RespuestaClienteSalida } from '../../contrato/facturacion.js';
import { ClienteServicio } from '../../mcp/cliente-servicio.js';
import type { PuertoTaller } from '../puertos.js';

// Cliente del MCP del Taller (grupo Falla). Las dos herramientas y sus campos salen del Excel
// MCP-Taller.xlsx (hojas Herramientas y Parámetros): registrar_respuesta_cliente y registrar_pago.
// Cada una acepta id_mensaje: en un reintento se envía el mismo y el Taller devuelve la respuesta
// de la primera vez sin repetir el cambio.
//
// PENDIENTE de confirmar con el grupo Falla (ver docs/pendientes-contratos.md):
//   - URL del MCP del Taller y cómo se autentica Facturación: aquí se usa un token de portador fijo
//     (TALLER_FACT_TOKEN). Si es OAuth client_credentials, pase clientId/clientSecret y quite tokenFijo.
//   - Rol con el que entra Facturación: el Excel dice que estas herramientas las puede llamar un
//     "agente" o el administrador.
//   - Los errores de negocio del Taller (hoja Errores) que no se deben reintentar.
export class TallerMcp implements PuertoTaller {
  private readonly cliente: ClienteServicio | null;

  constructor() {
    const { url, token } = FACTURACION.taller;
    this.cliente = url
      ? new ClienteServicio({ destino: 'taller', url, clientId: 'facturacion', clientSecret: '', alcances: [], tokenFijo: token || undefined })
      : null;
  }

  disponible(): boolean {
    return this.cliente !== null;
  }

  async registrarRespuestaCliente(entrada: z.infer<typeof RespuestaClienteSalida>): Promise<void> {
    await this.cliente!.llamar('registrar_respuesta_cliente', entrada as unknown as Record<string, unknown>);
  }

  async registrarPago(entrada: z.infer<typeof PagoSalida>): Promise<void> {
    await this.cliente!.llamar('registrar_pago', entrada as unknown as Record<string, unknown>);
  }
}
