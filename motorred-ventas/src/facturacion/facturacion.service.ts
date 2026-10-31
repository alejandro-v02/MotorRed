import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { DineroService, type LineaParaCalculo } from '../negocio/dinero.service.js';
import { ParametrosService } from '../negocio/parametros.service.js';
import { ClienteTallerReal } from './cliente-taller.js';
import type { CrearCotizacionInputT, NotificarReparacionTerminadaInputT, OrdenCompraLinea } from './esquemas.js';
import { PseSimuladoService } from './pse-simulado.service.js';
import { TelegramSimuladoService } from './telegram-simulado.service.js';
import { TiendaBuscadorService } from './tienda-buscador.service.js';

// Orquestador de la integración con el taller REAL (contrato propio: ver ADR 0003 y
// docs/contratos-reales/mcp-taller.md). La contabilidad interna (DineroService, ventas,
// dispersiones, asientos) se reutiliza tal cual; lo nuevo es esta "cara" hacia el taller.
@Injectable()
export class FacturacionService {
  private readonly logger = new Logger(FacturacionService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly dinero: DineroService,
    private readonly parametros: ParametrosService,
    private readonly tiendas: TiendaBuscadorService,
    private readonly telegram: TelegramSimuladoService,
    private readonly pse: PseSimuladoService,
    private readonly clienteTaller: ClienteTallerReal,
  ) {}

  // ---------------------------------------------------------------- idempotencia de entrada ----

  private async yaProcesado(id_mensaje: string): Promise<boolean> {
    const filas = await this.db.query(`SELECT 1 FROM mensajes_procesados WHERE id_mensaje = $1`, [id_mensaje]);
    return filas.length > 0;
  }

  private async marcarProcesado(id_mensaje: string, herramienta: string, codigo: string): Promise<void> {
    await this.db.query(
      `INSERT INTO mensajes_procesados (id_mensaje, herramienta, codigo) VALUES ($1,$2,$3) ON CONFLICT (id_mensaje) DO NOTHING`,
      [id_mensaje, herramienta, codigo],
    );
  }

  // ---------------------------------------------------------------------- crear_cotizacion ----

  async recibirCotizacion(args: CrearCotizacionInputT): Promise<{ recibido: boolean }> {
    if (await this.yaProcesado(args.id_mensaje)) return { recibido: true };

    const cotizacion_ref = `FAC-${args.codigo}-${Date.now().toString(36)}`;
    const total_mano_obra = args.mano_obra.reduce((s, l) => s + l.precio, 0);
    const total_mano_obra_cliente = args.mano_obra.filter((l) => !l.garantia.valida).reduce((s, l) => s + l.precio, 0);
    const hay_repuestos = args.repuestos.length > 0;

    // Precio de cada repuesto, buscado en las tiendas (SIMULADO: ver TiendaBuscadorService).
    let total_repuestos_cliente = 0;
    const repuestosConPrecio: Array<{ linea: (typeof args.repuestos)[number]; tienda: string; precio_unitario: number }> = [];
    for (const l of args.repuestos) {
      const oferta = await this.tiendas.buscar(l.codigo_repuesto);
      repuestosConPrecio.push({ linea: l, tienda: oferta.tienda, precio_unitario: oferta.precio_unitario });
      if (!l.garantia.valida) total_repuestos_cliente += oferta.precio_unitario * l.cantidad;
    }

    const mensaje_garantia = this.redactarMensajeGarantia(args);

    await this.db.query(
      `INSERT INTO cotizaciones (cotizacion_ref, codigo, id_relacion, taller, sede, cliente, vehiculo, mano_obra, repuestos, total_mano_obra, total_mano_obra_cliente, total_repuestos_cliente, hay_repuestos, mensaje_garantia, id_mensaje_entrada)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        cotizacion_ref, args.codigo, args.id_relacion, args.taller, args.sede,
        JSON.stringify(args.cliente), JSON.stringify(args.vehiculo), JSON.stringify(args.mano_obra),
        JSON.stringify(repuestosConPrecio.map((r) => ({ ...r.linea, tienda: r.tienda, precio_unitario: r.precio_unitario }))),
        total_mano_obra, total_mano_obra_cliente, total_repuestos_cliente, hay_repuestos, mensaje_garantia, args.id_mensaje,
      ],
    );
    await this.marcarProcesado(args.id_mensaje, 'crear_cotizacion', args.codigo);

    const total_a_pagar = total_mano_obra_cliente + total_repuestos_cliente;
    await this.telegram.enviarCotizacion({
      cotizacion_ref, codigo: args.codigo, cliente: args.cliente, total_a_pagar,
      mensaje:
        `Hola ${args.cliente.nombre}, tu cotización para ${args.vehiculo.descripcion} (placa ${args.vehiculo.placa}) es de ` +
        `$${total_a_pagar.toLocaleString('es-CO')}. ${mensaje_garantia} Responde SÍ o NO.`,
    });
    this.logger.log(`Cotización ${cotizacion_ref} (orden ${args.codigo}) creada: mano de obra cliente $${total_mano_obra_cliente}, repuestos cliente $${total_repuestos_cliente}`);
    return { recibido: true };
  }

  private redactarMensajeGarantia(args: CrearCotizacionInputT): string {
    const cubiertas = [...args.mano_obra, ...args.repuestos].filter((l) => l.garantia.valida);
    if (cubiertas.length === 0) return 'Ningún ítem de esta cotización quedó cubierto por garantía.';
    const quienPaga = (p: string) => ({ fabricante: 'el fabricante', tienda: 'la tienda', taller: 'el taller', cliente: 'el cliente' })[p] ?? p;
    return `Cubierto por garantía (lo paga ${[...new Set(cubiertas.map((l) => quienPaga(l.garantia.pagador)))].join(', ')}): ${cubiertas.length} ítem(s).`;
  }

  // Simula la respuesta del cliente (ver POST /facturacion/sandbox/telegram/:cotizacion_ref/responder).
  async clienteRespondioCotizacion(cotizacion_ref: string, aceptada: boolean, motivo?: string): Promise<void> {
    const filas = await this.db.query(`SELECT * FROM cotizaciones WHERE cotizacion_ref = $1`, [cotizacion_ref]);
    const c = filas[0];
    if (!c) throw new Error(`No existe la cotización ${cotizacion_ref}`);
    if (c.estado !== 'pendiente_respuesta') throw new Error(`La cotización ${cotizacion_ref} ya está ${c.estado}`);

    const repuestos = c.repuestos as Array<{ codigo_repuesto: string; descripcion: string; cantidad: number; tienda: string; precio_unitario: number; garantia: { valida: boolean; pagador: string } }>;
    const orden_compra: OrdenCompraLinea[] = aceptada
      ? repuestos.map((r) => ({
          codigo_repuesto: r.codigo_repuesto, cantidad: r.cantidad, tienda: r.tienda, precio_unitario: r.precio_unitario,
          pagador: (r.garantia.valida ? r.garantia.pagador : 'cliente') as OrdenCompraLinea['pagador'],
        }))
      : [];

    await this.db.query(
      `UPDATE cotizaciones SET estado = $1, motivo_rechazo = $2, orden_compra = $3 WHERE cotizacion_ref = $4`,
      [aceptada ? 'aceptada' : 'rechazada', aceptada ? null : (motivo ?? 'El cliente rechazó la cotización'), JSON.stringify(orden_compra), cotizacion_ref],
    );

    await this.clienteTaller.llamar('registrar_respuesta_cliente', {
      codigo: c.codigo,
      aceptada,
      ...(aceptada ? {} : { motivo: motivo ?? 'El cliente rechazó la cotización' }),
      referencia: cotizacion_ref,
      orden_compra,
      id_mensaje: `fac-${cotizacion_ref}-respuesta`,
    });
    this.logger.log(`Cotización ${cotizacion_ref}: cliente ${aceptada ? 'aceptó' : 'rechazó'}. Avisado al taller.`);
  }

  // ---------------------------------------------------------- notificar_reparacion_terminada ----

  async recibirReparacionTerminada(args: NotificarReparacionTerminadaInputT): Promise<{ recibido: boolean }> {
    if (await this.yaProcesado(args.id_mensaje)) return { recibido: true };

    const filas = await this.db.query(`SELECT * FROM cotizaciones WHERE cotizacion_ref = $1`, [args.cotizacion_ref]);
    const c = filas[0];
    if (!c) throw new Error(`No existe la cotización ${args.cotizacion_ref}`);
    const ordenCompra = (c.orden_compra ?? []) as OrdenCompraLinea[];

    // Lo que paga el cliente: servicios realizados cuyo pagador es "cliente" + repuestos
    // comprados cuyo pagador es "cliente" (emparejados por codigo_repuesto con la orden de
    // compra de la cotización aceptada — el taller no nos manda su compra_id interno).
    const serviciosCliente = args.mano_obra_realizada.filter((l) => l.pagador === 'cliente');
    const partesCliente = args.partes_usadas
      .map((p) => ({ parte: p, compra: ordenCompra.find((o) => o.codigo_repuesto === p.codigo_repuesto) }))
      .filter((x) => x.compra && (x.compra.pagador ?? 'cliente') === 'cliente');

    const lineasCalculo: LineaParaCalculo[] = [
      ...serviciosCliente.map((l) => ({ beneficiario: 'taller', concepto: 'servicio' as const, cantidad: 1, precio_unitario: l.precio, iva_porcentaje: 19 })),
      ...partesCliente.map(({ parte, compra }) => ({ beneficiario: 'tienda', concepto: 'repuesto' as const, cantidad: parte.cantidad, precio_unitario: compra!.precio_unitario, iva_porcentaje: 19 })),
    ];
    const totales = this.dinero.totales(lineasCalculo);
    const referencia_pse = this.pse.generarReferencia();

    await this.db.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO pagos_pse (referencia_pse, codigo, cotizacion_ref, valor, id_mensaje_entrada) VALUES ($1,$2,$3,$4,$5)`,
        [referencia_pse, args.codigo, args.cotizacion_ref, totales.total, args.id_mensaje],
      );
    });
    await this.marcarProcesado(args.id_mensaje, 'notificar_reparacion_terminada', args.codigo);

    const cliente = c.cliente as { telefono: string; nombre: string };
    const url = await this.pse.enlacePago(referencia_pse, totales.total);
    await this.telegram.enviarPse({
      cotizacion_ref: args.cotizacion_ref, codigo: args.codigo, cliente, referencia_pse, valor: totales.total, url_pago: url,
      mensaje: `Hola ${cliente.nombre}, tu reparación (orden ${args.codigo}) está lista. Total a pagar: $${totales.total.toLocaleString('es-CO')}. Paga aquí: ${url}`,
    });
    this.logger.log(`Reparación terminada, orden ${args.codigo}: PSE ${referencia_pse} por $${totales.total}`);
    return { recibido: true };
  }

  // Simula la confirmación del pago PSE (ver POST /facturacion/sandbox/pse/:referencia_pse/confirmar).
  async confirmarPago(referencia_pse: string): Promise<void> {
    const filas = await this.db.query(`SELECT * FROM pagos_pse WHERE referencia_pse = $1`, [referencia_pse]);
    const pago = filas[0];
    if (!pago) throw new Error(`No existe el pago ${referencia_pse}`);
    if (pago.estado !== 'pendiente') throw new Error(`El pago ${referencia_pse} ya está ${pago.estado}`);

    const cFilas = await this.db.query(`SELECT * FROM cotizaciones WHERE cotizacion_ref = $1`, [pago.cotizacion_ref]);
    const c = cFilas[0];
    const ordenCompra = (c?.orden_compra ?? []) as OrdenCompraLinea[];

    // Reconstruye las mismas líneas que en recibirReparacionTerminada para liquidar y dejar la
    // contabilidad interna (dispersión + asientos), reutilizando DineroService.liquidar().
    // Simplificación: liquida sobre lo que quedó en la orden de compra de la cotización
    // aceptada (no guardamos aparte mano_obra_realizada/partes_usadas de la notificación).
    const manoObraCliente = (c.mano_obra as Array<{ sku: string; precio: number; garantia: { valida: boolean } }>).filter((l) => !l.garantia.valida);
    const repuestosCliente = ordenCompra.filter((o) => (o.pagador ?? 'cliente') === 'cliente');
    const lineas: LineaParaCalculo[] = [
      ...manoObraCliente.map((l) => ({ beneficiario: 'taller', concepto: 'servicio' as const, cantidad: 1, precio_unitario: l.precio, iva_porcentaje: 19 })),
      ...repuestosCliente.map((r) => ({ beneficiario: 'tienda', concepto: 'repuesto' as const, cantidad: r.cantidad, precio_unitario: r.precio_unitario, iva_porcentaje: 19 })),
    ];
    const parametrosActuales = await this.parametros.actuales();
    const liquidacion = this.dinero.liquidar(
      { lineas, pagador: { tipo: 'cliente', retenedor: false }, total_a_pagar: pago.valor },
      parametrosActuales,
    );

    const venta_id = `FAC-V-${Date.now().toString(36)}`;
    await this.db.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO ventas (venta_id, traza_id, orden_id, estado, pagador, subtotal, iva, retenciones, total, total_a_pagar, url_notificacion, liquidada)
         VALUES ($1,$2,$3,'liquidada',$4,$5,$6,0,$7,$8,'n/a',true)`,
        [venta_id, randomUUID(), pago.codigo, JSON.stringify({ tipo: 'cliente', documento: (c.cliente as { cedula: string }).cedula, nombre: (c.cliente as { nombre: string }).nombre, retenedor: false, autorizacion: null }),
          lineas.reduce((s, l) => s + l.cantidad * l.precio_unitario, 0), liquidacion.recaudado - lineas.reduce((s, l) => s + l.cantidad * l.precio_unitario, 0), liquidacion.recaudado, liquidacion.recaudado],
      );
      for (const d of liquidacion.dispersiones) {
        await manager.query(
          `INSERT INTO dispersiones (venta_id, beneficiario, base, iva, retencion, comision, iva_comision, neto, estado, referencia) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'transferida',$9)`,
          [venta_id, d.beneficiario, d.base, d.iva, d.retencion, d.comision, d.iva_comision, d.neto, `TR-${venta_id}-${d.beneficiario.toUpperCase()}`],
        );
      }
      for (const a of liquidacion.asientos) {
        await manager.query(`INSERT INTO asientos (venta_id, cuenta, nombre_cuenta, tercero, debito, credito) VALUES ($1,$2,$3,$4,$5,$6)`, [venta_id, a.cuenta, a.nombre_cuenta, a.tercero, a.debito, a.credito]);
      }
      await manager.query(`UPDATE pagos_pse SET estado = 'confirmado' WHERE referencia_pse = $1`, [referencia_pse]);
      await manager.query(`UPDATE cotizaciones SET venta_id = $1 WHERE cotizacion_ref = $2`, [venta_id, pago.cotizacion_ref]);
    });

    await this.clienteTaller.llamar('registrar_pago', {
      codigo: pago.codigo,
      referencia_pse,
      valor: pago.valor,
      id_mensaje: `fac-${referencia_pse}-pago`,
    });
    this.logger.log(`Pago ${referencia_pse} confirmado, orden ${pago.codigo}: venta interna ${venta_id} liquidada (cuadra=${liquidacion.cuadra})`);
  }
}
