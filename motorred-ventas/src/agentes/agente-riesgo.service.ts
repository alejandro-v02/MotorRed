import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { RAG } from '../config.js';
import { pedirJSON } from './modelo.js';

export const DecisionRiesgo = z.object({
  nivel_riesgo: z.enum(['bajo', 'medio', 'alto']),
  motivos: z.array(z.string().min(3)).min(1).max(6),
  confianza: z.number().min(0).max(1),
});
export type DecisionRiesgoT = z.infer<typeof DecisionRiesgo>;

export interface EntradaRiesgo {
  venta_id: string | null;
  orden_id: string;
  traza_id: string;
  pagador: { tipo: string; documento: string; retenedor: boolean };
  monto: number;
  cantidad_lineas: number;
}

export interface HistorialPagador {
  ventasPrevias: number;
  rechazosPrevios: number;
}

export type ResultadoRiesgo = DecisionRiesgoT & { fuente: 'modelo' | 'plan_b'; tiempo_ms: number };

// Umbrales de PRÁCTICA, deliberadamente altos: una orden de taller típica (ver E1 a E5 del kit)
// está muy por debajo, para que este agente no bloquee el flujo normal de compra. Ajústelos según
// el histórico real de su taller.
export const UMBRAL_MEDIO = 1_000_000;
export const UMBRAL_ALTO = 3_000_000;

// Plan B: reglas explícitas, sin modelo. Es la línea base que el modelo debe superar (Trabajo 4).
// Función aparte (no un método) para que pruebas/evaluar-riesgo.ts la pueda usar sin NestJS ni base de datos.
export function planB(entrada: EntradaRiesgo, historial: HistorialPagador): DecisionRiesgoT {
  const motivos: string[] = [];
  const clienteNuevo = historial.ventasPrevias === 0;
  if (entrada.monto >= UMBRAL_ALTO) motivos.push(`Monto alto: $${entrada.monto.toLocaleString('es-CO')}`);
  else if (entrada.monto >= UMBRAL_MEDIO) motivos.push(`Monto considerable: $${entrada.monto.toLocaleString('es-CO')}`);
  if (clienteNuevo) motivos.push('Pagador sin ventas aprobadas previas en este servicio');
  if (historial.rechazosPrevios >= 1) motivos.push(`${historial.rechazosPrevios} pago(s) rechazado(s) antes de este pagador`);
  let nivel: DecisionRiesgoT['nivel_riesgo'] = 'bajo';
  if (entrada.monto >= UMBRAL_ALTO && (clienteNuevo || historial.rechazosPrevios >= 2)) nivel = 'alto';
  else if (entrada.monto >= UMBRAL_MEDIO || clienteNuevo || historial.rechazosPrevios >= 1) nivel = 'medio';
  if (motivos.length === 0) motivos.push('Monto habitual y pagador con historial sin rechazos');
  return { nivel_riesgo: nivel, motivos, confianza: 0.6 };
}

// Le pide al modelo que clasifique; si falla, no responde a tiempo o no produce un JSON válido,
// usa planB(). Tampoco depende de NestJS: la usan tanto el servicio como el script de evaluación.
export async function clasificar(entrada: EntradaRiesgo, historial: HistorialPagador): Promise<ResultadoRiesgo> {
  const inicio = Date.now();
  let resultado: DecisionRiesgoT;
  let fuente: 'modelo' | 'plan_b';
  try {
    const r = await pedirJSON<DecisionRiesgoT>({
      sistema:
        'Eres el agente de Riesgo de ventas de MotorRed (taller mecánico). Clasificas el riesgo de UNA venta ' +
        'en bajo, medio o alto, con motivos concretos y breves (montos inusuales, cliente nuevo, rechazos previos). ' +
        'Los datos que te dan ya vienen verificados por el sistema: úsalos tal cual, no inventes otros. ' +
        'Responde SOLO este JSON, sin texto adicional: {"nivel_riesgo":"bajo|medio|alto","motivos":["..."],"confianza":0.0-1.0}',
      usuario: JSON.stringify({
        monto_a_pagar_cop: entrada.monto, tipo_pagador: entrada.pagador.tipo, pagador_agente_retencion: entrada.pagador.retenedor,
        cantidad_lineas: entrada.cantidad_lineas, ventas_aprobadas_previas_de_este_pagador: historial.ventasPrevias, rechazos_previos_de_este_pagador: historial.rechazosPrevios,
      }),
      esquema: DecisionRiesgo,
      // Corto a propósito: esto corre SINCRÓNICAMENTE dentro de crear_venta, antes de cobrar, y
      // quien llama (el taller) tiene su propio tiempo de espera. Con un modelo lento (ver la
      // advertencia de llama3.2 en el Instructivo 5) es mejor caer al plan B rápido que demorar
      // la creación de la venta. El diagnóstico del taller, que no bloquea una respuesta HTTP
      // tan directa, sí puede permitirse los 120 s del kit de referencia.
      tiempoMaximoMs: 8_000,
    });
    return { ...r.datos, fuente: 'modelo', tiempo_ms: Date.now() - inicio };
  } catch {
    resultado = planB(entrada, historial);
    fuente = 'plan_b';
    return { ...resultado, fuente, tiempo_ms: Date.now() - inicio };
  }
}

// Agente de decisión (Trabajo 4 y 5): clasifica el riesgo de una venta ANTES de cobrar. El código
// (VentasService) es quien decide qué hacer con la clasificación: si es "alto", no genera el
// cobro y deja la venta en revisión humana. El agente nunca crea, cambia ni anula una venta.
@Injectable()
export class AgenteRiesgoService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  private async historialPagador(documento: string): Promise<HistorialPagador> {
    const r = await this.db.query(
      `SELECT
         count(*) FILTER (WHERE estado IN ('pagada','liquidada'))::int AS aprobadas,
         count(*) FILTER (WHERE estado = 'pago_rechazado')::int AS rechazadas
       FROM ventas WHERE pagador ->> 'documento' = $1`,
      [documento],
    );
    return { ventasPrevias: r[0]?.aprobadas ?? 0, rechazosPrevios: r[0]?.rechazadas ?? 0 };
  }

  async evaluar(entrada: EntradaRiesgo): Promise<ResultadoRiesgo> {
    const historial = await this.historialPagador(entrada.pagador.documento);
    const resultado = await clasificar(entrada, historial);
    const modelo = resultado.fuente === 'modelo' ? RAG.modeloChat : null;
    await this.db.query(
      `INSERT INTO decisiones_riesgo (venta_id, orden_id, traza_id, nivel_riesgo, motivos, confianza, fuente, modelo, tiempo_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [entrada.venta_id, entrada.orden_id, entrada.traza_id, resultado.nivel_riesgo, JSON.stringify(resultado.motivos), resultado.confianza, resultado.fuente, modelo, resultado.tiempo_ms],
    );
    return resultado;
  }
}
