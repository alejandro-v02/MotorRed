import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { PARAMETROS_POR_DEFECTO } from '../config.js';

export interface Parametros {
  iva_porcentaje: number;
  comision_porcentaje: number;
  uvt: number;
  retefuente: {
    servicio: { tarifa: number; base_uvt: number };
    repuesto: { tarifa: number; base_uvt: number };
  };
}

// Lee las tarifas y bases VIGENTES HOY desde parametros_tributarios (nunca escritas en el código:
// cambian por decreto, ver Concepto 5 del Instructivo 5). Si la tabla está vacía (antes del seed),
// usa los valores de práctica de config.ts para que el servicio no se caiga.
@Injectable()
export class ParametrosService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  private async vigente(concepto: string): Promise<{ tarifa: number | null; base_uvt: number | null; valor: number | null } | null> {
    const filas = await this.db.query(
      `SELECT tarifa, base_uvt, valor FROM parametros_tributarios
       WHERE concepto = $1 AND vigente_desde <= current_date AND (vigente_hasta IS NULL OR vigente_hasta >= current_date)
       ORDER BY vigente_desde DESC LIMIT 1`,
      [concepto],
    );
    if (!filas[0]) return null;
    return { tarifa: filas[0].tarifa === null ? null : Number(filas[0].tarifa), base_uvt: filas[0].base_uvt === null ? null : Number(filas[0].base_uvt), valor: filas[0].valor };
  }

  async actuales(): Promise<Parametros> {
    const [iva, comision, uvt, retServicio, retRepuesto] = await Promise.all([
      this.vigente('iva_general'), this.vigente('comision_plataforma'), this.vigente('uvt'),
      this.vigente('retefuente_servicio'), this.vigente('retefuente_repuesto'),
    ]);
    const d = PARAMETROS_POR_DEFECTO;
    return {
      iva_porcentaje: iva?.tarifa ?? d.iva_porcentaje,
      comision_porcentaje: comision?.tarifa ?? d.comision_porcentaje,
      uvt: uvt?.valor ?? d.uvt,
      retefuente: {
        servicio: { tarifa: retServicio?.tarifa ?? d.retefuente.servicio.tarifa, base_uvt: retServicio?.base_uvt ?? d.retefuente.servicio.base_uvt },
        repuesto: { tarifa: retRepuesto?.tarifa ?? d.retefuente.repuesto.tarifa, base_uvt: retRepuesto?.base_uvt ?? d.retefuente.repuesto.base_uvt },
      },
    };
  }
}
