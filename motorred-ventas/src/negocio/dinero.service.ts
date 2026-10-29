import { Injectable } from '@nestjs/common';
import type { Parametros } from './parametros.service.js';

export interface LineaParaCalculo {
  beneficiario: string;
  concepto: 'servicio' | 'repuesto' | 'garantia';
  cantidad: number;
  precio_unitario: number;
  iva_porcentaje: number;
}

export interface PagadorParaCalculo {
  tipo: 'cliente' | 'concesionario';
  retenedor: boolean;
}

export interface Dispersion {
  beneficiario: string;
  base: number;
  iva: number;
  retencion: number;
  comision: number;
  iva_comision: number;
  neto: number;
}

export interface Asiento {
  cuenta: string;
  nombre_cuenta: string;
  tercero: string;
  debito: number;
  credito: number;
}

export interface Liquidacion {
  recaudado: number;
  dispersiones: Dispersion[];
  ingreso_plataforma: number;
  asientos: Asiento[];
  cuadra: boolean;
}

// Cálculos de dinero en pesos enteros, portados de ecosistema-motor/lib/dinero.mjs (la referencia
// de comportamiento). Regla del contrato: el IVA se calcula por línea y se redondea al peso.
@Injectable()
export class DineroService {
  private redondear(v: number) {
    return Math.round(v);
  }

  private baseLinea(l: LineaParaCalculo) {
    return l.cantidad * l.precio_unitario;
  }

  ivaLinea(l: LineaParaCalculo) {
    return this.redondear((this.baseLinea(l) * l.iva_porcentaje) / 100);
  }

  totales(lineas: LineaParaCalculo[]) {
    const subtotal = lineas.reduce((s, l) => s + this.baseLinea(l), 0);
    const iva = lineas.reduce((s, l) => s + this.ivaLinea(l), 0);
    return { subtotal, iva, total: subtotal + iva };
  }

  // Retención en la fuente que practica un pagador agente de retención, por beneficiario y concepto.
  retenciones(lineas: LineaParaCalculo[], pagador: PagadorParaCalculo, parametros: Parametros): Record<string, number> {
    const porBeneficiario: Record<string, number> = {};
    if (!pagador.retenedor) return porBeneficiario;
    const grupos: Record<string, number> = {};
    for (const l of lineas.filter((x) => x.concepto !== 'garantia')) {
      const clave = `${l.beneficiario}|${l.concepto}`;
      grupos[clave] = (grupos[clave] ?? 0) + this.baseLinea(l);
    }
    for (const [clave, base] of Object.entries(grupos)) {
      const [beneficiario, concepto] = clave.split('|');
      const regla = parametros.retefuente[concepto as 'servicio' | 'repuesto'];
      const valor = base >= regla.base_uvt * parametros.uvt ? this.redondear((base * regla.tarifa) / 100) : 0;
      porBeneficiario[beneficiario] = (porBeneficiario[beneficiario] ?? 0) + valor;
    }
    return porBeneficiario;
  }

  // Liquidación de una venta pagada: cuánto recibe cada beneficiario, cuánto queda para la
  // plataforma y los asientos contables (partida doble, PUC ilustrativo).
  liquidar(venta: { lineas: LineaParaCalculo[]; pagador: PagadorParaCalculo; total_a_pagar: number }, parametros: Parametros): Liquidacion {
    const ret = this.retenciones(venta.lineas, venta.pagador, parametros);
    const conValor = venta.lineas.filter((l) => l.concepto !== 'garantia');
    const beneficiarios = [...new Set(conValor.map((l) => l.beneficiario))];
    const dispersiones: Dispersion[] = beneficiarios.map((b) => {
      const propias = conValor.filter((l) => l.beneficiario === b);
      const { subtotal: base, iva } = this.totales(propias);
      const retencion = ret[b] ?? 0;
      const comision = this.redondear((base * parametros.comision_porcentaje) / 100);
      const iva_comision = this.redondear((comision * parametros.iva_porcentaje) / 100);
      return { beneficiario: b, base, iva, retencion, comision, iva_comision, neto: base + iva - retencion - comision - iva_comision };
    });
    const recaudado = venta.total_a_pagar;
    const ingreso = dispersiones.reduce((s, d) => s + d.comision + d.iva_comision, 0);
    const asientos: Asiento[] = [{ cuenta: '111005', nombre_cuenta: 'Bancos - cuenta de recaudo', tercero: 'MotorRed', debito: recaudado, credito: 0 }];
    for (const d of dispersiones) {
      asientos.push({ cuenta: '281505', nombre_cuenta: 'Ingresos recibidos para terceros', tercero: d.beneficiario, debito: 0, credito: d.base + d.iva - d.retencion });
    }
    for (const d of dispersiones) {
      asientos.push({ cuenta: '281505', nombre_cuenta: 'Ingresos recibidos para terceros', tercero: d.beneficiario, debito: d.comision + d.iva_comision, credito: 0 });
      asientos.push({ cuenta: '415595', nombre_cuenta: 'Comisiones de la plataforma', tercero: d.beneficiario, debito: 0, credito: d.comision });
      asientos.push({ cuenta: '240810', nombre_cuenta: 'IVA generado sobre la comisión', tercero: 'DIAN', debito: 0, credito: d.iva_comision });
    }
    for (const d of dispersiones) {
      asientos.push({ cuenta: '281505', nombre_cuenta: 'Ingresos recibidos para terceros', tercero: d.beneficiario, debito: d.neto, credito: 0 });
      asientos.push({ cuenta: '111005', nombre_cuenta: 'Bancos - dispersión', tercero: d.beneficiario, debito: 0, credito: d.neto });
    }
    const debitos = asientos.reduce((s, a) => s + a.debito, 0);
    const creditos = asientos.reduce((s, a) => s + a.credito, 0);
    const cuadra =
      debitos === creditos &&
      dispersiones.reduce((s, d) => s + d.neto, 0) + ingreso === recaudado &&
      dispersiones.every((d) => d.neto >= 0);
    return { recaudado, dispersiones, ingreso_plataforma: ingreso, asientos, cuadra };
  }
}
