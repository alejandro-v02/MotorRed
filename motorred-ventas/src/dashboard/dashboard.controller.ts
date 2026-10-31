import { Controller, Get, Headers, HttpException, Param, Query, Res } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Response } from 'express';
import type { DataSource } from 'typeorm';
import { GRUPO, PUERTO, URLS } from '../config.js';
import { PAGINA } from './pagina.js';

// Dashboard de negocio: GET /dashboard. Resume ventas, cobros, contabilidad, riesgo y facturación
// directamente desde la base de datos, y consulta el detalle de una venta. Es solo lectura.
// Complementa al panel de logs (/panel), que muestra el tráfico y no el negocio.
// Usa el mismo PANEL_TOKEN que el panel: si está definido, hay que abrir /dashboard?token=...
// La página va embebida como texto (pagina.ts) para que viaje dentro de dist/ en la imagen Docker.
@Controller('dashboard')
export class DashboardController {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  private verificar(token?: string, autorizacion?: string) {
    const esperado = process.env.PANEL_TOKEN;
    if (!esperado) return;
    if (token !== esperado && autorizacion !== `Bearer ${esperado}`) {
      throw new HttpException({ error: 'Falta o es inválido el token (?token=...)' }, 401);
    }
  }

  // Una consulta que falla (tabla sin migrar, etc.) no tumba el dashboard: queda como aviso.
  private async q<T = Record<string, unknown>>(avisos: string[], nombre: string, sql: string, params: unknown[] = []): Promise<T[]> {
    try {
      return (await this.db.query(sql, params)) as T[];
    } catch (e) {
      avisos.push(`${nombre}: ${(e as Error).message}`);
      return [];
    }
  }

  @Get()
  pagina(@Res() res: Response, @Query('token') token?: string) {
    this.verificar(token);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(PAGINA.replace('__SERVICIO__', GRUPO));
  }

  @Get('api/resumen')
  async resumen(@Query('token') token?: string, @Headers('authorization') aut?: string) {
    this.verificar(token, aut);
    const avisos: string[] = [];
    const q = <T = Record<string, unknown>>(n: string, sql: string) => this.q<T>(avisos, n, sql);
    const RECAUDADO = `estado IN ('pagada','liquidada')`;

    const [
      kpis, porEstado, porDia, cobros, eventos, enRevision,
      dispersiones, cuentas, descuadradas, sinAsientos, sinDispersion,
      riesgo, riesgoFuente, cotizaciones, pagosPse, cotizacionesRecientes,
    ] = await Promise.all([
      q<{ ventas: number; recaudado: number; por_cobrar: number; en_revision: number; ticket: number }>('kpis', `
        SELECT count(*)::int AS ventas,
               coalesce(sum(total_a_pagar) FILTER (WHERE ${RECAUDADO}), 0)::float8 AS recaudado,
               coalesce(sum(total_a_pagar) FILTER (WHERE estado = 'pendiente_pago'), 0)::float8 AS por_cobrar,
               count(*) FILTER (WHERE estado = 'en_revision')::int AS en_revision,
               coalesce(avg(total_a_pagar) FILTER (WHERE ${RECAUDADO}), 0)::float8 AS ticket
        FROM ventas`),
      q('ventas_por_estado', `
        SELECT estado, count(*)::int AS n, coalesce(sum(total_a_pagar), 0)::float8 AS monto
        FROM ventas GROUP BY estado ORDER BY n DESC`),
      q('ventas_por_dia', `
        SELECT to_char(date_trunc('day', creada_en), 'YYYY-MM-DD') AS dia, count(*)::int AS n,
               coalesce(sum(total_a_pagar) FILTER (WHERE ${RECAUDADO}), 0)::float8 AS recaudado
        FROM ventas WHERE creada_en >= now() - interval '14 days' GROUP BY 1 ORDER BY 1`),
      q('cobros', `
        SELECT estado, count(*)::int AS n, coalesce(sum(monto), 0)::float8 AS monto
        FROM cobros GROUP BY estado ORDER BY n DESC`),
      q('eventos_pasarela', `
        SELECT tipo, resultado, count(*)::int AS n FROM eventos_pasarela GROUP BY tipo, resultado ORDER BY n DESC`),
      q('en_revision', `
        SELECT venta_id, orden_id, pagador->>'nombre' AS pagador, total_a_pagar, motivo, creada_en
        FROM ventas WHERE estado = 'en_revision' ORDER BY creada_en DESC LIMIT 20`),
      q('dispersiones', `
        SELECT beneficiario, count(*)::int AS n, sum(base)::float8 AS base, sum(iva)::float8 AS iva,
               sum(retencion)::float8 AS retencion, sum(comision + iva_comision)::float8 AS comision, sum(neto)::float8 AS neto
        FROM dispersiones GROUP BY beneficiario ORDER BY neto DESC`),
      q('asientos_por_cuenta', `
        SELECT cuenta, nombre_cuenta, sum(debito)::float8 AS debito, sum(credito)::float8 AS credito
        FROM asientos GROUP BY cuenta, nombre_cuenta ORDER BY cuenta`),
      q('ventas_descuadradas', `
        SELECT venta_id, sum(debito)::float8 AS debito, sum(credito)::float8 AS credito
        FROM asientos GROUP BY venta_id HAVING sum(debito) <> sum(credito) LIMIT 20`),
      q<{ n: number }>('liquidadas_sin_asientos', `
        SELECT count(*)::int AS n FROM ventas v
        WHERE v.liquidada AND NOT EXISTS (SELECT 1 FROM asientos a WHERE a.venta_id = v.venta_id)`),
      q<{ n: number }>('liquidadas_sin_dispersion', `
        SELECT count(*)::int AS n FROM ventas v
        WHERE v.liquidada AND NOT EXISTS (SELECT 1 FROM dispersiones d WHERE d.venta_id = v.venta_id)`),
      q('riesgo', `
        SELECT nivel_riesgo, count(*)::int AS n, coalesce(avg(tiempo_ms), 0)::float8 AS ms
        FROM decisiones_riesgo GROUP BY nivel_riesgo ORDER BY n DESC`),
      q('riesgo_fuente', `SELECT fuente, count(*)::int AS n FROM decisiones_riesgo GROUP BY fuente ORDER BY n DESC`),
      q('cotizaciones', `
        SELECT estado, count(*)::int AS n,
               coalesce(sum(total_mano_obra_cliente + total_repuestos_cliente), 0)::float8 AS monto
        FROM cotizaciones GROUP BY estado ORDER BY n DESC`),
      q('pagos_pse', `
        SELECT estado, count(*)::int AS n, coalesce(sum(valor), 0)::float8 AS monto
        FROM pagos_pse GROUP BY estado ORDER BY n DESC`),
      q('cotizaciones_recientes', `
        SELECT cotizacion_ref, taller, cliente->>'nombre' AS cliente, estado,
               (total_mano_obra_cliente + total_repuestos_cliente)::float8 AS total, venta_id, creada_en
        FROM cotizaciones ORDER BY creada_en DESC LIMIT 10`),
    ]);

    return {
      servicio: GRUPO,
      generado_en: new Date().toISOString(),
      kpis: kpis[0] ?? { ventas: 0, recaudado: 0, por_cobrar: 0, en_revision: 0, ticket: 0 },
      ventas_por_estado: porEstado,
      ventas_por_dia: porDia,
      cobros,
      eventos_pasarela: eventos,
      en_revision: enRevision,
      contabilidad: {
        dispersiones,
        cuentas,
        descuadradas,
        liquidadas_sin_asientos: sinAsientos[0]?.n ?? 0,
        liquidadas_sin_dispersion: sinDispersion[0]?.n ?? 0,
      },
      riesgo: { por_nivel: riesgo, por_fuente: riesgoFuente },
      facturacion: { cotizaciones, pagos_pse: pagosPse, recientes: cotizacionesRecientes },
      avisos,
    };
  }

  @Get('api/ventas')
  async ventas(
    @Query('estado') estado = '',
    @Query('q') texto = '',
    @Query('limite') limite = '50',
    @Query('token') token?: string,
    @Headers('authorization') aut?: string,
  ) {
    this.verificar(token, aut);
    const avisos: string[] = [];
    const tope = Math.min(Math.max(Number(limite) || 50, 1), 200);
    const filas = await this.q(avisos, 'ventas', `
      SELECT venta_id, orden_id, estado, pagador->>'nombre' AS pagador, pagador->>'documento' AS documento,
             total_a_pagar, liquidada, motivo, creada_en
      FROM ventas
      WHERE ($1 = '' OR estado = $1)
        AND ($2 = '' OR venta_id ILIKE '%' || $2 || '%' OR orden_id ILIKE '%' || $2 || '%'
             OR pagador->>'nombre' ILIKE '%' || $2 || '%' OR pagador->>'documento' ILIKE '%' || $2 || '%')
      ORDER BY creada_en DESC LIMIT $3`, [estado, texto, tope]);
    return { ventas: filas, avisos };
  }

  @Get('api/ventas/:id')
  async detalle(@Param('id') id: string, @Query('token') token?: string, @Headers('authorization') aut?: string) {
    this.verificar(token, aut);
    const avisos: string[] = [];
    const [venta] = await this.q(avisos, 'venta', `
      SELECT venta_id, orden_id, estado, pagador, subtotal, iva, retenciones, total, total_a_pagar,
             url_pago, cobro_id, motivo, liquidada, creada_en
      FROM ventas WHERE venta_id = $1`, [id]);
    if (!venta) throw new HttpException({ error: `No existe la venta ${id}` }, 404);
    const [lineas, cobros, dispersiones, asientos, riesgo] = await Promise.all([
      this.q(avisos, 'lineas', `SELECT beneficiario, concepto, referencia, descripcion, cantidad, precio_unitario, iva_porcentaje FROM lineas_venta WHERE venta_id = $1 ORDER BY id`, [id]),
      this.q(avisos, 'cobros', `SELECT cobro_id, monto, estado, creado_en FROM cobros WHERE venta_id = $1 ORDER BY creado_en`, [id]),
      this.q(avisos, 'dispersiones', `SELECT beneficiario, base, iva, retencion, comision, iva_comision, neto, estado FROM dispersiones WHERE venta_id = $1 ORDER BY id`, [id]),
      this.q(avisos, 'asientos', `SELECT cuenta, nombre_cuenta, tercero, debito, credito FROM asientos WHERE venta_id = $1 ORDER BY id`, [id]),
      this.q(avisos, 'riesgo', `SELECT nivel_riesgo, motivos, fuente, tiempo_ms FROM decisiones_riesgo WHERE venta_id = $1 ORDER BY id DESC LIMIT 1`, [id]),
    ]);
    return { venta, lineas, cobros, dispersiones, asientos, riesgo: riesgo[0] ?? null, avisos };
  }

  // Estado de los servicios del ecosistema: responde /salud o no, y en cuántos ms.
  @Get('api/servicios')
  async servicios(@Query('token') token?: string, @Headers('authorization') aut?: string) {
    this.verificar(token, aut);
    const destinos: Array<[string, string]> = [
      ['pasarela', URLS.pasarela], ['taller', URLS.taller], ['tienda', URLS.tienda], ['concesionario', URLS.concesionario],
    ];
    const t0 = Date.now();
    const base = await this.db.query('SELECT 1').then(() => true).catch(() => false);
    const propios = [
      { nombre: GRUPO, url: `http://localhost:${PUERTO}`, ok: true, ms: 0, detalle: 'este servicio' },
      { nombre: 'base de datos', url: 'PostgreSQL', ok: base, ms: Date.now() - t0, detalle: base ? 'responde' : 'sin conexión' },
    ];
    const externos = await Promise.all(destinos.map(async ([nombre, url]) => {
      const t = Date.now();
      try {
        const r = await fetch(`${url}/salud`, { signal: AbortSignal.timeout(1500) });
        return { nombre, url, ok: r.ok, ms: Date.now() - t, detalle: r.ok ? 'responde' : `HTTP ${r.status}` };
      } catch {
        return { nombre, url, ok: false, ms: Date.now() - t, detalle: 'sin respuesta' };
      }
    }));
    return { servicios: [...propios, ...externos], generado_en: new Date().toISOString() };
  }
}
