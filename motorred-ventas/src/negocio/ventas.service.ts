import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { DataSource, Repository } from 'typeorm';
import type { z } from 'zod';
import { AgenteRiesgoService } from '../agentes/agente-riesgo.service.js';
import { FIRMA_EVENTOS_PASARELA, FIRMA_EVENTOS_VENTAS, NOTIFICACIONES_PERMITIDAS, PASARELA_LLAVE, URL_PROPIA, URLS } from '../config.js';
import type { LineaVenta, Pagador } from '../contrato/esquemas.js';
import { enviarEvento } from '../mcp/eventos.js';
import { verificarFirma } from '../mcp/firma.js';
import { BitacoraService } from '../mcp/bitacora.service.js';
import { VentaEntity } from '../db/entidades/venta.entity.js';
import { LineaVentaEntity } from '../db/entidades/linea-venta.entity.js';
import type { Dispersion as DispersionCalculada } from './dinero.service.js';
import { DineroService } from './dinero.service.js';
import { ErrorNegocio } from './errores.js';
import { ParametrosService } from './parametros.service.js';
import { type Proveedor, ProveedoresService } from './proveedores.service.js';

type LineaVentaInput = z.infer<typeof LineaVenta>;
type PagadorInput = z.infer<typeof Pagador>;

interface ReservaProveedor {
  reserva_id: string;
  proveedor: string;
  estado: string;
  venta_id: string | null;
  items: { sku: string; cantidad: number; precio_unitario: number; iva_porcentaje: number }[];
}

export interface CrearVentaInput {
  traza_id: string;
  clave_idempotencia: string;
  orden_id: string;
  pagador: PagadorInput;
  lineas: LineaVentaInput[];
  url_notificacion: string;
}

export interface VentaPublica {
  venta_id: string;
  orden_id: string;
  traza_id: string;
  estado: string;
  pagador: PagadorInput;
  lineas: LineaVentaInput[];
  subtotal: number;
  iva: number;
  retenciones: number;
  total: number;
  total_a_pagar: number;
  url_pago: string | null;
  creada_en: string;
}

export interface LiquidacionPublica {
  venta_id: string;
  estado: string;
  recaudado: number;
  dispersiones: unknown[];
  ingreso_plataforma: number;
  asientos: unknown[];
  cuadra: boolean;
}

interface WebhookPasarela {
  evento_id: string;
  tipo: string;
  cobro_id: string;
  referencia: string;
  monto: number;
  fecha: string;
}

// Orquestador comercial del ecosistema (grupo Zaidy): crea la venta, verifica cada línea contra
// la reserva real del proveedor, cobra con la pasarela, y cuando el pago se aprueba, corre la
// SAGA (confirmar reservas → liquidar → dispersar), con compensación si algo falla a mitad de camino.
@Injectable()
export class VentasService {
  // Serializa llamadas simultáneas con la misma clave de idempotencia dentro de este proceso
  // (igual que el Map de la referencia): la promesa se guarda ANTES del primer await.
  private readonly enVuelo = new Map<string, { huella: string; promesa: Promise<VentaEntity> }>();
  // Evita procesar el mismo evento_id del webhook dos veces en paralelo mientras el primero corre.
  private readonly enCurso = new Set<string>();
  // Cola de notificaciones por venta: venta.pagada siempre sale antes que venta.liquidada.
  private readonly colas = new Map<string, Promise<unknown>>();

  constructor(
    @InjectRepository(VentaEntity) private readonly ventasRepo: Repository<VentaEntity>,
    @InjectDataSource() private readonly db: DataSource,
    private readonly dinero: DineroService,
    private readonly parametros: ParametrosService,
    private readonly proveedores: ProveedoresService,
    private readonly bitacora: BitacoraService,
    private readonly riesgo: AgenteRiesgoService,
  ) {}

  // ---------------------------------------------------------------- utilidades internas ----

  private huella(obj: unknown): string {
    return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
  }

  private async buscar(venta_id: string, traza_id: string): Promise<VentaEntity> {
    const venta = await this.ventasRepo.findOne({ where: { venta_id }, relations: ['lineas'] });
    // Con otra traza, NO_ENCONTRADO y no 403: así no se revela que la venta existe.
    if (!venta || venta.traza_id !== traza_id) throw new ErrorNegocio('NO_ENCONTRADO', `No existe la venta ${venta_id}`);
    return venta;
  }

  private publica(v: VentaEntity): VentaPublica {
    return {
      venta_id: v.venta_id,
      orden_id: v.orden_id,
      traza_id: v.traza_id,
      estado: v.estado,
      pagador: v.pagador,
      lineas: (v.lineas ?? []).map((l) => ({
        beneficiario: l.beneficiario as LineaVentaInput['beneficiario'],
        concepto: l.concepto as LineaVentaInput['concepto'],
        referencia: l.referencia,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precio_unitario: l.precio_unitario,
        iva_porcentaje: Number(l.iva_porcentaje),
        reserva_id: l.reserva_id,
      })),
      subtotal: v.subtotal,
      iva: v.iva,
      retenciones: v.retenciones,
      total: v.total,
      total_a_pagar: v.total_a_pagar,
      url_pago: v.url_pago,
      creada_en: v.creada_en.toISOString(),
    };
  }

  private lineasParaCalculo(lineas: LineaVentaEntity[]): LineaVentaInput[] {
    return lineas.map((l) => ({
      beneficiario: l.beneficiario as LineaVentaInput['beneficiario'],
      concepto: l.concepto as LineaVentaInput['concepto'],
      referencia: l.referencia,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precio_unitario: l.precio_unitario,
      iva_porcentaje: Number(l.iva_porcentaje),
      reserva_id: l.reserva_id,
    }));
  }

  private reservasDe(lineas: LineaVentaInput[]): [string, Proveedor][] {
    const mapa = new Map<string, Proveedor>();
    for (const l of lineas) if (l.reserva_id) mapa.set(l.reserva_id, l.beneficiario as Proveedor);
    return [...mapa.entries()];
  }

  // Verifica cada línea contra la reserva real del proveedor: nadie puede cobrar otro precio ni
  // usar una reserva de otra orden o que ya pertenece a otra venta (ownership por reserva_id).
  private async verificarLineas(traza_id: string, lineas: LineaVentaInput[], pagador: PagadorInput, ventaIdActual: string | null): Promise<void> {
    if (pagador.tipo === 'concesionario') {
      if (!/^GAR-/.test(pagador.autorizacion ?? '')) throw new ErrorNegocio('DATOS_INVALIDOS', 'Si paga el concesionario, la venta necesita la autorización de garantía (GAR-...)');
      if (lineas.some((l) => l.concepto === 'repuesto')) throw new ErrorNegocio('DATOS_INVALIDOS', 'En una venta de garantía los repuestos van como concepto garantia, con precio 0');
    }
    const consultadas = new Map<string, ReservaProveedor>();
    for (const l of lineas) {
      if (l.concepto === 'servicio') {
        if (l.beneficiario !== 'taller' || l.reserva_id) throw new ErrorNegocio('DATOS_INVALIDOS', 'Solo el taller factura servicios, y sin reserva');
        continue;
      }
      if (!l.reserva_id) throw new ErrorNegocio('DATOS_INVALIDOS', `La línea ${l.referencia} es un repuesto y necesita reserva_id`);
      if (l.beneficiario === 'taller') throw new ErrorNegocio('DATOS_INVALIDOS', 'Los repuestos los factura su proveedor, no el taller');
      if (l.concepto === 'garantia' && (l.beneficiario !== 'concesionario' || l.precio_unitario !== 0 || pagador.tipo !== 'concesionario')) {
        throw new ErrorNegocio('DATOS_INVALIDOS', `${l.referencia}: un repuesto en garantía lo entrega el concesionario con precio 0, en la venta que paga el concesionario`);
      }
      const filas = await this.db.query(`SELECT venta_id FROM reservas_venta_activas WHERE reserva_id = $1`, [l.reserva_id]);
      const duena = filas[0]?.venta_id as string | undefined;
      if (duena && duena !== ventaIdActual) throw new ErrorNegocio('ESTADO_INVALIDO', `La reserva ${l.reserva_id} ya pertenece a la venta ${duena}`);
      if (!consultadas.has(l.reserva_id)) {
        const reserva = await this.proveedores.de(l.beneficiario as Proveedor).llamar<ReservaProveedor>('consultar_reserva', { traza_id, reserva_id: l.reserva_id });
        consultadas.set(l.reserva_id, reserva);
      }
      const reserva = consultadas.get(l.reserva_id)!;
      if (reserva.estado !== 'activa') throw new ErrorNegocio('RESERVA_VENCIDA', `La reserva ${l.reserva_id} está ${reserva.estado}`);
      const item = reserva.items.find((i) => i.sku === l.referencia);
      if (!item) throw new ErrorNegocio('DATOS_INVALIDOS', `La reserva ${l.reserva_id} no incluye ${l.referencia}`);
      if (l.concepto === 'repuesto' && (item.precio_unitario !== l.precio_unitario || item.iva_porcentaje !== l.iva_porcentaje)) {
        throw new ErrorNegocio('PRECIO_NO_COINCIDE', `${l.referencia}: la reserva dice ${item.precio_unitario} + IVA ${item.iva_porcentaje}%, la venta dice ${l.precio_unitario} + IVA ${l.iva_porcentaje}%`);
      }
      const pedidas = lineas.filter((x) => x.reserva_id === l.reserva_id && x.referencia === l.referencia).reduce((s, x) => s + x.cantidad, 0);
      if (pedidas > item.cantidad) throw new ErrorNegocio('DATOS_INVALIDOS', `${l.referencia}: se reservaron ${item.cantidad} unidades y la venta pide ${pedidas}`);
    }
  }

  // Compensación: libera solo las reservas de esta venta (activas, o confirmadas a su nombre).
  private async liberarTodo(venta: VentaEntity, motivo: string): Promise<void> {
    for (const [reserva_id, proveedor] of this.reservasDe(this.lineasParaCalculo(venta.lineas))) {
      try {
        const r = await this.proveedores.de(proveedor).llamar<ReservaProveedor>('consultar_reserva', { traza_id: venta.traza_id, reserva_id });
        if (r.estado === 'activa' || (r.estado === 'confirmada' && r.venta_id === venta.venta_id)) {
          await this.proveedores.de(proveedor).llamar('liberar_reserva', { traza_id: venta.traza_id, reserva_id, motivo });
        }
      } catch (e) {
        this.bitacora.registrar({ traza_id: venta.traza_id, evento: 'compensacion_fallida', ok: false, error: (e as Error).message, reserva_id });
      }
    }
  }

  private notificar(venta: VentaEntity, tipo: string, datos: Record<string, unknown> = {}): void {
    const evento = {
      evento_id: `EVV-${randomUUID()}`, tipo, fecha: new Date().toISOString(), traza_id: venta.traza_id,
      datos: { venta_id: venta.venta_id, orden_id: venta.orden_id, estado: venta.estado, ...datos },
    };
    const anterior = this.colas.get(venta.venta_id) ?? Promise.resolve();
    const siguiente = anterior.then(async () => {
      const enviado = await enviarEvento(venta.url_notificacion, evento, FIRMA_EVENTOS_VENTAS);
      this.bitacora.registrar({ traza_id: venta.traza_id, evento: `enviado ${tipo}`, ok: enviado, venta_id: venta.venta_id });
    });
    this.colas.set(venta.venta_id, siguiente);
  }

  private async aRevision(venta: VentaEntity, motivo: string): Promise<void> {
    venta.estado = 'en_revision';
    venta.motivo = motivo;
    await this.ventasRepo.update({ venta_id: venta.venta_id }, { estado: 'en_revision', motivo });
    this.bitacora.registrar({ traza_id: venta.traza_id, evento: 'venta_en_revision', ok: true, venta_id: venta.venta_id, motivo });
  }

  private async cobrar(venta: VentaEntity): Promise<void> {
    const r = await fetch(`${URLS.pasarela}/api/cobros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PASARELA_LLAVE}` },
      body: JSON.stringify({ referencia: venta.venta_id, monto: venta.total_a_pagar, descripcion: `Orden ${venta.orden_id}`, url_webhook: `${URL_PROPIA}/webhooks/pasarela` }),
      signal: AbortSignal.timeout(10_000),
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: (e as Error).message }) }) as Response);
    const datos = (await r.json().catch(() => ({}))) as { cobro_id?: string; url_checkout?: string; error?: string };
    if (!r.ok || !datos.cobro_id) throw new ErrorNegocio('PROVEEDOR_NO_DISPONIBLE', `La pasarela no creó el cobro: ${datos.error ?? r.status}`, true);
    venta.cobro_id = datos.cobro_id;
    venta.url_pago = datos.url_checkout ?? null;
    await this.db.query(`INSERT INTO cobros (cobro_id, venta_id, monto, estado, url_pago) VALUES ($1,$2,$3,'pendiente',$4)`, [datos.cobro_id, venta.venta_id, venta.total_a_pagar, venta.url_pago]);
    await this.ventasRepo.update({ venta_id: venta.venta_id }, { cobro_id: venta.cobro_id, url_pago: venta.url_pago });
  }

  private async persistirLiquidacion(venta: VentaEntity, dispersiones: (DispersionCalculada & { estado: string; referencia: string })[], asientos: { cuenta: string; nombre_cuenta: string; tercero: string; debito: number; credito: number }[]): Promise<void> {
    await this.db.transaction(async (manager) => {
      for (const d of dispersiones) {
        await manager.query(
          `INSERT INTO dispersiones (venta_id, beneficiario, base, iva, retencion, comision, iva_comision, neto, estado, referencia) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [venta.venta_id, d.beneficiario, d.base, d.iva, d.retencion, d.comision, d.iva_comision, d.neto, d.estado, d.referencia],
        );
      }
      for (const a of asientos) {
        await manager.query(`INSERT INTO asientos (venta_id, cuenta, nombre_cuenta, tercero, debito, credito) VALUES ($1,$2,$3,$4,$5,$6)`, [venta.venta_id, a.cuenta, a.nombre_cuenta, a.tercero, a.debito, a.credito]);
      }
      await manager.update(VentaEntity, { venta_id: venta.venta_id }, { estado: 'liquidada', liquidada: true });
    });
  }

  // SAGA posterior al pago aprobado: confirmar cada reserva; si una falla, compensar (liberar +
  // reembolsar). Si todo sale bien, liquidar y dispersar. Si la liquidación no cuadra, en_revision.
  private async alAprobarse(venta: VentaEntity): Promise<void> {
    venta.estado = 'pagada';
    await this.ventasRepo.update({ venta_id: venta.venta_id }, { estado: 'pagada' });
    this.notificar(venta, 'venta.pagada');
    try {
      for (const [reserva_id, proveedor] of this.reservasDe(this.lineasParaCalculo(venta.lineas))) {
        await this.proveedores.de(proveedor).llamar('confirmar_reserva', { traza_id: venta.traza_id, reserva_id, venta_id: venta.venta_id });
      }
    } catch (e) {
      this.bitacora.registrar({ traza_id: venta.traza_id, evento: 'saga_compensacion', ok: false, venta_id: venta.venta_id, motivo: (e as Error).message });
      await this.liberarTodo(venta, `Compensación de ${venta.venta_id}: ${(e as Error).message}`);
      if (venta.cobro_id) {
        const r = await fetch(`${URLS.pasarela}/api/cobros/${venta.cobro_id}/reembolso`, { method: 'POST', headers: { Authorization: `Bearer ${PASARELA_LLAVE}` }, signal: AbortSignal.timeout(10_000) }).catch(() => ({ ok: false, status: 0 }) as Response);
        if (!r.ok) return this.aRevision(venta, `El reembolso falló (HTTP ${r.status}) después de: ${(e as Error).message}`);
      }
      venta.estado = 'reembolsada';
      venta.motivo = (e as Error).message;
      await this.ventasRepo.update({ venta_id: venta.venta_id }, { estado: 'reembolsada', motivo: venta.motivo });
      this.notificar(venta, 'venta.reembolsada', { motivo: venta.motivo });
      return;
    }
    const parametros = await this.parametros.actuales();
    const liquidacion = this.dinero.liquidar({ lineas: this.lineasParaCalculo(venta.lineas), pagador: venta.pagador, total_a_pagar: venta.total_a_pagar }, parametros);
    if (!liquidacion.cuadra) return this.aRevision(venta, 'La liquidación no cuadra: no se dispersa dinero');
    const dispersionesFinal = liquidacion.dispersiones.map((d) => ({ ...d, estado: 'transferida', referencia: `TR-${venta.venta_id}-${d.beneficiario.toUpperCase()}` }));
    await this.persistirLiquidacion(venta, dispersionesFinal, liquidacion.asientos);
    venta.estado = 'liquidada';
    venta.liquidada = true;
    this.bitacora.registrar({ traza_id: venta.traza_id, evento: 'venta_liquidada', ok: true, venta_id: venta.venta_id, recaudado: liquidacion.recaudado, cuadra: liquidacion.cuadra });
    this.notificar(venta, 'venta.liquidada', { dispersiones: dispersionesFinal.map(({ beneficiario, neto }) => ({ beneficiario, neto })) });
  }

  // ---------------------------------------------------------------------- creación ----

  private async crear(args: CrearVentaInput): Promise<VentaEntity> {
    if (!NOTIFICACIONES_PERMITIDAS.includes(new URL(args.url_notificacion).origin)) {
      throw new ErrorNegocio('DATOS_INVALIDOS', 'url_notificacion no está entre los destinos permitidos');
    }
    await this.verificarLineas(args.traza_id, args.lineas, args.pagador, null);
    const t = this.dinero.totales(args.lineas);
    const parametros = await this.parametros.actuales();
    const ret = Object.values(this.dinero.retenciones(args.lineas, args.pagador, parametros)).reduce((s, x) => s + x, 0);
    const venta_id = await this.siguienteVentaId();
    const total_a_pagar = t.total - ret;

    // Transacción: crear la venta, sus líneas y reclamar sus reservas de una sola vez. La
    // restricción UNIQUE de reservas_venta_activas hace que, si otra venta se adelantó mientras
    // este proceso esperaba las llamadas anteriores, aquí falle con ESTADO_INVALIDO.
    await this.db.transaction(async (manager) => {
      await manager.insert(VentaEntity, {
        venta_id, orden_id: args.orden_id, traza_id: args.traza_id, estado: 'pendiente_pago', pagador: args.pagador,
        subtotal: t.subtotal, iva: t.iva, retenciones: ret, total: t.total, total_a_pagar, url_pago: null, url_notificacion: args.url_notificacion,
      });
      if (args.lineas.length) {
        await manager.insert(
          LineaVentaEntity,
          args.lineas.map((l) => ({ venta_id, beneficiario: l.beneficiario, concepto: l.concepto, referencia: l.referencia, descripcion: l.descripcion, cantidad: l.cantidad, precio_unitario: l.precio_unitario, iva_porcentaje: l.iva_porcentaje, reserva_id: l.reserva_id })),
        );
      }
      // Varias líneas pueden compartir una misma reserva (p. ej. bujías y bobina reservadas
      // juntas en la tienda): se reclama cada reserva UNA sola vez, no una vez por línea.
      for (const [reserva_id] of this.reservasDe(args.lineas)) {
        try {
          await manager.query(`INSERT INTO reservas_venta_activas (reserva_id, venta_id) VALUES ($1, $2)`, [reserva_id, venta_id]);
        } catch (e) {
          if ((e as { code?: string }).code === '23505') throw new ErrorNegocio('ESTADO_INVALIDO', `La reserva ${reserva_id} ya pertenece a otra venta`);
          throw e;
        }
      }
    });

    const venta = await this.ventasRepo.findOneOrFail({ where: { venta_id }, relations: ['lineas'] });
    try {
      if (venta.total_a_pagar > 0) {
        // Baranda del agente de Riesgo: propone, no dispone. Si clasifica alto, el código (no el
        // agente) decide no generar el cobro y deja la venta para revisión humana.
        const riesgo = await this.riesgo.evaluar({
          venta_id: venta.venta_id, orden_id: venta.orden_id, traza_id: venta.traza_id,
          pagador: venta.pagador, monto: venta.total_a_pagar, cantidad_lineas: venta.lineas.length,
        });
        if (riesgo.nivel_riesgo === 'alto') {
          await this.aRevision(venta, `Riesgo alto antes de cobrar (agente, ${riesgo.fuente}): ${riesgo.motivos.join('; ')}`);
        } else {
          await this.cobrar(venta);
        }
      } else {
        // Nada que cobrar (p. ej. venta íntegramente en garantía): se confirma y liquida de una vez.
        setImmediate(() => this.alAprobarse(venta).catch((e) => this.bitacora.registrar({ traza_id: venta.traza_id, evento: 'error_no_manejado', ok: false, venta_id, error: (e as Error).message })));
      }
    } catch (e) {
      await this.ventasRepo.delete({ venta_id }); // cascada borra lineas_venta y reservas_venta_activas
      throw e;
    }
    return venta;
  }

  private async siguienteVentaId(): Promise<string> {
    const r = await this.db.query(`SELECT nextval('ventas_consecutivo') AS n`);
    return `V-${String(r[0].n).padStart(6, '0')}`;
  }

  async crearVenta(args: CrearVentaInput, cliente: string): Promise<VentaPublica> {
    const clave = `${cliente}|${args.clave_idempotencia}`;
    const huella = this.huella({ traza_id: args.traza_id, orden_id: args.orden_id, pagador: args.pagador, lineas: args.lineas });
    let entrada = this.enVuelo.get(clave);
    if (entrada && entrada.huella !== huella) throw new ErrorNegocio('IDEMPOTENCIA_CONFLICTO', 'Esa clave de idempotencia ya se usó con otra venta');
    if (!entrada) {
      entrada = { huella, promesa: this.crearConPersistencia(args, cliente, huella) };
      this.enVuelo.set(clave, entrada);
      entrada.promesa.catch(() => this.enVuelo.delete(clave));
    }
    return this.publica(await entrada.promesa);
  }

  // Resuelve con la base de datos (sobrevive a un reinicio del proceso) antes de crear de verdad.
  private async crearConPersistencia(args: CrearVentaInput, cliente: string, huella: string): Promise<VentaEntity> {
    const previo = await this.db.query(`SELECT huella, venta_id FROM claves_idempotencia WHERE cliente = $1 AND clave = $2`, [cliente, args.clave_idempotencia]);
    if (previo[0]) {
      if (previo[0].huella !== huella) throw new ErrorNegocio('IDEMPOTENCIA_CONFLICTO', 'Esa clave de idempotencia ya se usó con otra venta');
      return this.ventasRepo.findOneOrFail({ where: { venta_id: previo[0].venta_id }, relations: ['lineas'] });
    }
    const venta = await this.crear(args);
    await this.db.query(
      `INSERT INTO claves_idempotencia (cliente, clave, huella, operacion, venta_id) VALUES ($1,$2,$3,'crear_venta',$4) ON CONFLICT (cliente, clave) DO NOTHING`,
      [cliente, args.clave_idempotencia, huella, venta.venta_id],
    );
    return venta;
  }

  // ---------------------------------------------------------------------- consultas y acciones ----

  async consultarVenta(args: { traza_id: string; venta_id: string }): Promise<VentaPublica> {
    return this.publica(await this.buscar(args.venta_id, args.traza_id));
  }

  async generarCobro(args: { traza_id: string; venta_id: string }): Promise<VentaPublica> {
    const venta = await this.buscar(args.venta_id, args.traza_id);
    if (venta.estado === 'pendiente_pago') return this.publica(venta); // idempotente: el cobro vigente
    if (venta.estado !== 'pago_rechazado') throw new ErrorNegocio('ESTADO_INVALIDO', `La venta ${args.venta_id} está ${venta.estado}; solo se genera un cobro nuevo si el pago fue rechazado`);
    await this.verificarLineas(venta.traza_id, this.lineasParaCalculo(venta.lineas), venta.pagador, venta.venta_id); // las reservas deben seguir activas
    const fresca = await this.buscar(args.venta_id, args.traza_id);
    if (fresca.estado !== 'pago_rechazado') return this.publica(fresca);
    await this.ventasRepo.update({ venta_id: fresca.venta_id }, { estado: 'pendiente_pago' });
    fresca.estado = 'pendiente_pago';
    try {
      await this.cobrar(fresca);
    } catch (e) {
      await this.ventasRepo.update({ venta_id: fresca.venta_id }, { estado: 'pago_rechazado' });
      throw e;
    }
    return this.publica(fresca);
  }

  async anularVenta(args: { traza_id: string; venta_id: string; motivo: string }): Promise<VentaPublica> {
    const venta = await this.buscar(args.venta_id, args.traza_id);
    if (venta.estado === 'anulada') return this.publica(venta);
    if (!['pendiente_pago', 'pago_rechazado'].includes(venta.estado)) throw new ErrorNegocio('ESTADO_INVALIDO', `No se puede anular una venta ${venta.estado}`);
    await this.ventasRepo.update({ venta_id: venta.venta_id }, { estado: 'anulada', motivo: `Anulación: ${args.motivo}` });
    venta.estado = 'anulada';
    await this.liberarTodo(venta, `Anulación: ${args.motivo}`);
    await this.db.query(`DELETE FROM reservas_venta_activas WHERE venta_id = $1`, [venta.venta_id]);
    return this.publica(venta);
  }

  async consultarLiquidacion(args: { traza_id: string; venta_id: string }): Promise<LiquidacionPublica> {
    const venta = await this.buscar(args.venta_id, args.traza_id);
    if (!venta.liquidada) throw new ErrorNegocio('ESTADO_INVALIDO', `La venta ${args.venta_id} está ${venta.estado} y todavía no tiene liquidación`);
    const dispersiones = await this.db.query(`SELECT beneficiario, base, iva, retencion, comision, iva_comision, neto, estado, referencia FROM dispersiones WHERE venta_id = $1 ORDER BY id`, [venta.venta_id]);
    const asientos = await this.db.query(`SELECT cuenta, nombre_cuenta, tercero, debito, credito FROM asientos WHERE venta_id = $1 ORDER BY id`, [venta.venta_id]);
    const ingreso_plataforma = dispersiones.reduce((s: number, d: { comision: number; iva_comision: number }) => s + d.comision + d.iva_comision, 0);
    const debitos = asientos.reduce((s: number, a: { debito: number }) => s + a.debito, 0);
    const creditos = asientos.reduce((s: number, a: { credito: number }) => s + a.credito, 0);
    return { venta_id: venta.venta_id, estado: venta.estado, recaudado: venta.total_a_pagar, dispersiones, ingreso_plataforma, asientos, cuadra: debitos === creditos };
  }

  // ---------------------------------------------------------------------- webhook de la pasarela ----

  async manejarWebhookPasarela(cuerpoCrudo: string, firmaCabecera: string | undefined): Promise<{ status: number; body: unknown }> {
    if (!verificarFirma(cuerpoCrudo, firmaCabecera, FIRMA_EVENTOS_PASARELA)) {
      this.bitacora.registrar({ traza_id: null, evento: 'webhook_rechazado', ok: false, motivo: 'firma inválida' });
      return { status: 401, body: { error: 'Firma inválida' } };
    }
    const e = JSON.parse(cuerpoCrudo) as WebhookPasarela;
    // referencia = venta_id (así lo mandamos al crear el cobro): se usa para que el registro de
    // un duplicado quede con la traza_id correcta y aparezca en GET /bitacora?traza_id=.
    const venta = await this.ventasRepo.findOne({ where: { venta_id: e.referencia }, relations: ['lineas'] });
    if (this.enCurso.has(e.evento_id)) {
      this.bitacora.registrar({ traza_id: venta?.traza_id ?? null, evento: 'webhook_duplicado_ignorado', ok: true, evento_id: e.evento_id, motivo: 'ya en curso' });
      return { status: 200, body: { recibido: true, duplicado: true } };
    }
    const previo = await this.db.query(`SELECT 1 FROM eventos_pasarela WHERE evento_id = $1`, [e.evento_id]);
    if (previo.length) {
      this.bitacora.registrar({ traza_id: venta?.traza_id ?? null, evento: 'webhook_duplicado_ignorado', ok: true, evento_id: e.evento_id });
      return { status: 200, body: { recibido: true, duplicado: true } };
    }
    if (!venta || venta.cobro_id !== e.cobro_id) {
      await this.db.query(`INSERT INTO eventos_pasarela (evento_id, cobro_id, venta_id, tipo, monto, resultado) VALUES ($1,$2,$3,$4,$5,'ignorado')`, [e.evento_id, e.cobro_id, venta?.venta_id ?? null, e.tipo, e.monto]);
      return { status: 200, body: { recibido: true, ignorado: 'cobro desconocido o reemplazado' } };
    }
    this.enCurso.add(e.evento_id);
    try {
      this.bitacora.registrar({ traza_id: venta.traza_id, evento: `webhook ${e.tipo}`, ok: true, venta_id: venta.venta_id, monto: e.monto });
      if (e.tipo === 'cobro.aprobado' && venta.estado === 'pendiente_pago') {
        if (e.monto !== venta.total_a_pagar) await this.aRevision(venta, `La pasarela reporta ${e.monto} y la venta vale ${venta.total_a_pagar}`);
        else await this.alAprobarse(venta);
      } else if (e.tipo === 'cobro.rechazado' && venta.estado === 'pendiente_pago') {
        venta.estado = 'pago_rechazado';
        await this.ventasRepo.update({ venta_id: venta.venta_id }, { estado: 'pago_rechazado' });
        await this.db.query(`UPDATE cobros SET estado = 'rechazado' WHERE cobro_id = $1`, [venta.cobro_id]);
        this.notificar(venta, 'venta.pago_rechazado');
      }
      await this.db.query(`INSERT INTO eventos_pasarela (evento_id, cobro_id, venta_id, tipo, monto, resultado) VALUES ($1,$2,$3,$4,$5,'procesado')`, [e.evento_id, e.cobro_id, venta.venta_id, e.tipo, e.monto]);
      return { status: 200, body: { recibido: true } };
    } catch (error) {
      // No se registra en eventos_pasarela: si falla, la pasarela reintenta (regla del contrato).
      this.bitacora.registrar({ traza_id: venta.traza_id, evento: 'webhook_fallido', ok: false, evento_id: e.evento_id, error: (error as Error).message });
      return { status: 500, body: { error: 'No se pudo procesar; reintente' } };
    } finally {
      this.enCurso.delete(e.evento_id);
    }
  }
}
