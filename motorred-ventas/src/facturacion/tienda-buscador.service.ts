import { Injectable, Logger } from '@nestjs/common';
import { REPUESTOS_API } from '../config.js';

export interface OfertaRepuesto {
  repuesto_id: string;
  sku: string;
  tienda: string;
  precio_unitario: number;
  disponible: number;
}

// Cliente REAL de la API del concesionario (ver
// docs/contratos-reales/documentacion-api-repuestos.xlsx). Reemplaza el catálogo simulado que
// tenía este servicio mientras no existía el contrato (ver ADR 0003).
//
// Supuesto clave, sin confirmar con ese grupo: su catálogo usa como `sku` el mismo
// `codigo_repuesto` que manda el taller (ej. "PAS-DEL-CER"). Su API no tiene un campo
// `codigo_repuesto`, solo `id` (uuid) y `sku` único. Si algún código del taller no tiene un sku
// exactamente igual en su catálogo, se usa el resultado más parecido por búsqueda de texto libre
// y se avisa por log — para no tumbar la cotización, pero hay que confirmar esto con ellos.
@Injectable()
export class TiendaBuscadorService {
  private readonly logger = new Logger(TiendaBuscadorService.name);

  private async peticion(ruta: string, init?: RequestInit): Promise<Response> {
    return fetch(`${REPUESTOS_API.url}${ruta}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(10_000),
    });
  }

  // Precio y disponibilidad. Solo lectura: no reserva nada (eso es decisión de negocio, se hace
  // recién cuando el cliente acepta la cotización — ver FacturacionService.clienteRespondioCotizacion).
  async buscar(codigo_repuesto: string, cantidad: number): Promise<OfertaRepuesto> {
    const r = await this.peticion(`/api/repuestos?texto=${encodeURIComponent(codigo_repuesto)}&limite=10`);
    if (!r.ok) throw new Error(`API de repuestos respondió ${r.status} buscando "${codigo_repuesto}"`);
    const { items } = (await r.json()) as { items: Array<{ id: string; sku: string; precio: number }> };
    const exacto = items.find((i) => i.sku === codigo_repuesto.toUpperCase());
    const elegido = exacto ?? items[0];
    if (!elegido) throw new Error(`El concesionario no tiene ningún repuesto parecido a "${codigo_repuesto}"`);
    if (!exacto) {
      this.logger.warn(
        `"${codigo_repuesto}" no coincide exacto con ningún SKU del concesionario; se usó el más parecido (${elegido.sku}). Confirmar con ese grupo si usan otros códigos.`,
      );
    }

    const stock = await this.peticion(`/api/stock/repuestos/${elegido.id}`);
    const disponible = stock.ok ? ((await stock.json()) as { totalDisponible: number }).totalDisponible : 0;
    if (disponible < cantidad) {
      this.logger.warn(`Solo hay ${disponible} unidad(es) disponible(s) de ${elegido.sku}, se está cotizando ${cantidad}`);
    }

    return { repuesto_id: elegido.id, sku: elegido.sku, tienda: REPUESTOS_API.nombre, precio_unitario: elegido.precio, disponible };
  }

  // Aparta unidades (no baja el físico) cuando el cliente acepta la cotización.
  async reservar(repuesto_id: string, cantidad: number, referencia: string, motivo: string): Promise<void> {
    const r = await this.peticion('/api/stock/reservas', {
      method: 'POST',
      body: JSON.stringify({ repuestoId: repuesto_id, cantidad, bodega: REPUESTOS_API.bodega, motivo, referencia }),
    });
    if (!r.ok) throw new Error(`No se pudo reservar ${cantidad} unidad(es) del repuesto ${repuesto_id}: ${await r.text()}`);
  }

  // Devuelve a disponible lo reservado que al final no se usó (reparación terminada con menos
  // repuestos de los cotizados, o cotización rechazada).
  async liberarReserva(repuesto_id: string, cantidad: number, referencia: string, motivo: string): Promise<void> {
    if (cantidad <= 0) return;
    const r = await this.peticion('/api/stock/reservas/liberar', {
      method: 'POST',
      body: JSON.stringify({ repuestoId: repuesto_id, cantidad, bodega: REPUESTOS_API.bodega, motivo, referencia }),
    });
    if (!r.ok) this.logger.warn(`No se pudo liberar la reserva de ${cantidad} unidad(es) del repuesto ${repuesto_id}: ${await r.text()}`);
  }

  // Consume lo reservado (baja el físico) cuando el taller confirma que el repuesto sí se usó.
  async confirmarConsumo(repuesto_id: string, cantidad: number, referencia: string): Promise<void> {
    if (cantidad <= 0) return;
    const r = await this.peticion('/api/stock/salidas', {
      method: 'POST',
      body: JSON.stringify({ repuestoId: repuesto_id, cantidad, bodega: REPUESTOS_API.bodega, desdeReserva: true, referencia, motivo: 'Reparación terminada' }),
    });
    if (!r.ok) throw new Error(`No se pudo confirmar el consumo de ${cantidad} unidad(es) del repuesto ${repuesto_id}: ${await r.text()}`);
  }
}
