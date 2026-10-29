import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { RagService } from './rag.service.js';

export interface Diferencia {
  venta_id: string;
  tipo: 'monto_no_coincide' | 'liquidacion_no_cuadra' | 'venta_sin_evento';
  detalle: string;
}

// Agente de Conciliación (Trabajo 5): compara ventas, cobros y eventos de la pasarela, y reporta
// diferencias. El cálculo de cada diferencia es código determinista (no se le pide al modelo que
// sume ni compare dinero); el RAG solo aporta las citas de la política para explicar el reporte.
// No cambia el estado de ninguna venta ni tiene acceso a ninguna herramienta que escriba.
@Injectable()
export class AgenteConciliacionService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly rag: RagService,
  ) {}

  async reporte(dias = 7): Promise<{ generado_en: string; ventas_revisadas: number; diferencias: Diferencia[]; fuentes: { titulo: string; fuente: string }[] }> {
    const ventas = await this.db.query(
      `SELECT venta_id, estado, total_a_pagar FROM ventas WHERE creada_en >= now() - ($1 || ' days')::interval`,
      [dias],
    );
    const diferencias: Diferencia[] = [];

    for (const v of ventas) {
      if (['pagada', 'liquidada', 'reembolsada'].includes(v.estado)) {
        const eventos = await this.db.query(`SELECT monto, tipo FROM eventos_pasarela WHERE venta_id = $1 AND tipo = 'cobro.aprobado' ORDER BY recibido_en`, [v.venta_id]);
        const aprobado = eventos[0];
        if (aprobado && Number(aprobado.monto) !== Number(v.total_a_pagar)) {
          diferencias.push({ venta_id: v.venta_id, tipo: 'monto_no_coincide', detalle: `La pasarela reportó $${aprobado.monto} y la venta vale $${v.total_a_pagar}` });
        }
      }
      if (v.estado === 'liquidada') {
        const asientos = await this.db.query(`SELECT coalesce(sum(debito),0)::int AS d, coalesce(sum(credito),0)::int AS c FROM asientos WHERE venta_id = $1`, [v.venta_id]);
        if (asientos[0] && asientos[0].d !== asientos[0].c) {
          diferencias.push({ venta_id: v.venta_id, tipo: 'liquidacion_no_cuadra', detalle: `Débitos $${asientos[0].d} vs. créditos $${asientos[0].c}` });
        }
      }
    }

    const sinEvento = await this.db.query(
      `SELECT venta_id FROM ventas v WHERE estado = 'pendiente_pago' AND creada_en < now() - interval '15 minutes'
       AND NOT EXISTS (SELECT 1 FROM eventos_pasarela e WHERE e.venta_id = v.venta_id)`,
    );
    for (const v of sinEvento) diferencias.push({ venta_id: v.venta_id, tipo: 'venta_sin_evento', detalle: 'Lleva más de 15 minutos pendiente de pago sin ningún evento de la pasarela' });

    const citas = await this.rag.recuperar('qué diferencias reporta la conciliación de ventas', 2).catch(() => []);
    return { generado_en: new Date().toISOString(), ventas_revisadas: ventas.length, diferencias, fuentes: citas.map((c) => ({ titulo: c.titulo, fuente: c.fuente })) };
  }
}
