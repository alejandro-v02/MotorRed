import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { RagService } from './rag.service.js';

// Agente Contable (Trabajo 5): arma el cierre del día y explica una liquidación en lenguaje
// llano. Los valores SIEMPRE salen de consultar_liquidacion / las tablas (nunca los recalcula el
// modelo); el RAG aporta las citas de la política contable para la explicación.
@Injectable()
export class AgenteContableService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly rag: RagService,
  ) {}

  async cierreDelDia(fecha: string = new Date().toISOString().slice(0, 10)) {
    const resumen = await this.db.query(
      `SELECT count(*)::int AS ventas_liquidadas, coalesce(sum(total_a_pagar),0)::int AS recaudado
       FROM ventas WHERE estado = 'liquidada' AND actualizada_en::date = $1`,
      [fecha],
    );
    const porBeneficiario = await this.db.query(
      `SELECT d.beneficiario, sum(d.neto)::int AS neto, sum(d.comision + d.iva_comision)::int AS comision
       FROM dispersiones d JOIN ventas v ON v.venta_id = d.venta_id
       WHERE v.estado = 'liquidada' AND v.actualizada_en::date = $1 GROUP BY d.beneficiario`,
      [fecha],
    );
    const enRevision = await this.db.query(`SELECT venta_id, motivo FROM ventas WHERE estado = 'en_revision' AND actualizada_en::date = $1`, [fecha]);
    return { fecha, ventas_liquidadas: resumen[0].ventas_liquidadas, recaudado: resumen[0].recaudado, por_beneficiario: porBeneficiario, en_revision: enRevision };
  }

  async explicarLiquidacion(venta_id: string) {
    const filas = await this.db.query(`SELECT venta_id, estado, total_a_pagar FROM ventas WHERE venta_id = $1`, [venta_id]);
    const venta = filas[0];
    if (!venta) throw new Error(`No existe la venta ${venta_id}`);
    const dispersiones = await this.db.query(`SELECT beneficiario, base, iva, retencion, comision, iva_comision, neto FROM dispersiones WHERE venta_id = $1 ORDER BY id`, [venta_id]);
    const asientos = await this.db.query(`SELECT cuenta, nombre_cuenta, tercero, debito, credito FROM asientos WHERE venta_id = $1 ORDER BY id`, [venta_id]);
    const citas = await this.rag.recuperar('cómo se explica una liquidación y la retención en la fuente', 2).catch(() => []);
    return { venta_id, estado: venta.estado, total_a_pagar: venta.total_a_pagar, dispersiones, asientos, fuentes: citas.map((c) => ({ titulo: c.titulo, fuente: c.fuente })) };
  }
}
