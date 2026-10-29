import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { RagService } from './rag.service.js';

// Agente de Cobro (Trabajo 5): redacta el recordatorio de pago. NO tiene permiso para llamar
// generar_cobro, anular_venta ni ninguna herramienta que mueva dinero: solo lee y redacta texto.
// Baranda "cifras y enlaces con respaldo" (Concepto 3): el monto y el enlace de pago SIEMPRE se
// toman tal cual de la base de datos, nunca los redacta el modelo.
@Injectable()
export class AgenteCobroService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly rag: RagService,
  ) {}

  async pendientesDeRecordatorio(minutos = 30) {
    return this.db.query(
      `SELECT venta_id, orden_id, url_pago, total_a_pagar, creada_en FROM ventas
       WHERE estado = 'pendiente_pago' AND creada_en < now() - ($1 || ' minutes')::interval ORDER BY creada_en`,
      [minutos],
    );
  }

  async redactarRecordatorio(venta_id: string): Promise<{ venta_id: string; mensaje: string; fuentes: { titulo: string; fuente: string }[] }> {
    const filas = await this.db.query(`SELECT venta_id, orden_id, url_pago, total_a_pagar, estado FROM ventas WHERE venta_id = $1`, [venta_id]);
    const venta = filas[0];
    if (!venta) throw new Error(`No existe la venta ${venta_id}`);
    if (venta.estado !== 'pendiente_pago') throw new Error(`La venta ${venta_id} está ${venta.estado}, no pendiente de pago`);
    const citas = await this.rag.recuperar('recordatorio de pago, qué puede decir el agente de cobro', 2).catch(() => []);
    const monto = Number(venta.total_a_pagar).toLocaleString('es-CO');
    const mensaje = `Hola, tu orden ${venta.orden_id} tiene un pago pendiente de $${monto}. Puedes pagarlo en este enlace: ${venta.url_pago}`;
    return { venta_id, mensaje, fuentes: citas.map((c) => ({ titulo: c.titulo, fuente: c.fuente })) };
  }
}
