import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { DineroService, type LineaParaCalculo } from '../negocio/dinero.service.js';
import { ParametrosService } from '../negocio/parametros.service.js';
import { AgenteFacturacionService } from './agente-facturacion.service.js';
import { ClienteTallerReal } from './cliente-taller.js';
import type { CrearCotizacionInputT, NotificarReparacionTerminadaInputT, OrdenCompraLinea } from './esquemas.js';
import { PseSimuladoService } from './pse-simulado.service.js';
import { TelegramSimuladoService } from './telegram-simulado.service.js';
import { TiendaBuscadorService, type PedidoT } from './tienda-buscador.service.js';

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
    private readonly agente: AgenteFacturacionService,
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

    // Precio (sin IVA) y disponibilidad de todos los repuestos, preguntados en UN mensaje al agente
    // de repuestos (ver TiendaBuscadorService). Solo consulta: no aparta nada todavía, eso se
    // hace si el cliente acepta.
    let total_repuestos_cliente = 0;
    const repuestosConPrecio: Array<{ linea: (typeof args.repuestos)[number]; tienda: string; precio_unitario: number; sku: string }> = [];
    if (hay_repuestos) {
      const lineasPedido = args.repuestos.map((l) => ({ codigo_repuesto: l.codigo_repuesto, cantidad: l.cantidad }));
      const r = await this.agente.ejecutar({
        tipo: 'cotizar', codigo_orden: args.codigo, hablar: true, repuestos: lineasPedido, repuestos_critico: true,
        id_repuestos: `fac-${args.id_mensaje}-cotizar`,
        hechos: { taller: args.taller, vehiculo: args.vehiculo.descripcion, repuestos_a_cotizar: lineasPedido },
      });
      const ofertas = this.tiendas.ofertasDesdeDatos(lineasPedido, r.datos.values(), r.respuestas.at(-1)?.respuesta);
      for (const l of args.repuestos) {
        const oferta = ofertas.get(l.codigo_repuesto)!;
        repuestosConPrecio.push({ linea: l, tienda: oferta.tienda, precio_unitario: oferta.precio_unitario, sku: oferta.sku });
        if (!l.garantia.valida) total_repuestos_cliente += oferta.precio_unitario * l.cantidad;
      }
    }

    const mensaje_garantia = this.redactarMensajeGarantia(args);

    await this.db.query(
      `INSERT INTO cotizaciones (cotizacion_ref, codigo, id_relacion, taller, sede, cliente, vehiculo, mano_obra, repuestos, total_mano_obra, total_mano_obra_cliente, total_repuestos_cliente, hay_repuestos, mensaje_garantia, id_mensaje_entrada)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        cotizacion_ref, args.codigo, args.id_relacion, args.taller, args.sede,
        JSON.stringify(args.cliente), JSON.stringify(args.vehiculo), JSON.stringify(args.mano_obra),
        JSON.stringify(repuestosConPrecio.map((r) => ({ ...r.linea, tienda: r.tienda, precio_unitario: r.precio_unitario, sku: r.sku }))),
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

    const repuestos = c.repuestos as Array<{ codigo_repuesto: string; descripcion: string; cantidad: number; tienda: string; precio_unitario: number; sku?: string; garantia: { valida: boolean; pagador: string } }>;
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

    const avisoTaller = {
      codigo: c.codigo,
      aceptada,
      ...(aceptada ? {} : { motivo: motivo ?? 'El cliente rechazó la cotización' }),
      referencia: cotizacion_ref,
      orden_compra,
      id_mensaje: `fac-${cotizacion_ref}-respuesta`,
    };
    if (aceptada) {
      // El agente decide el orden: pedirle a repuestos que aparte (solo baja el disponible, no el
      // físico) y avisar al taller. Un fallo al apartar no detiene el negocio: ya quedó aceptada y
      // se deja en el log para seguimiento (ver AgenteFacturacionService).
      await this.agente.ejecutar({
        tipo: 'aceptada', codigo_orden: c.codigo, hablar: repuestos.length > 0,
        repuestos: repuestos.map((r) => ({ codigo_repuesto: r.codigo_repuesto, cantidad: r.cantidad })),
        id_repuestos: `fac-${cotizacion_ref}-aceptar`,
        taller: { herramienta: 'registrar_respuesta_cliente', args: avisoTaller },
        hechos: { cotizacion: cotizacion_ref, el_cliente: 'aceptó la cotización', repuestos_cotizados: repuestos.map((r) => ({ codigo_repuesto: r.codigo_repuesto, cantidad: r.cantidad })) },
      });
    } else {
      // Rechazada: no hay stock que mover, solo se le avisa al taller.
      await this.clienteTaller.llamar('registrar_respuesta_cliente', avisoTaller);
    }
    this.logger.log(`Cotización ${cotizacion_ref}: cliente ${aceptada ? 'aceptó' : 'rechazó'}. Avisado al taller.`);
  }

  // ---------------------------------------------------------- notificar_reparacion_terminada ----

  async recibirReparacionTerminada(args: NotificarReparacionTerminadaInputT): Promise<{ recibido: boolean }> {
    if (await this.yaProcesado(args.id_mensaje)) return { recibido: true };

    const filas = await this.db.query(`SELECT * FROM cotizaciones WHERE cotizacion_ref = $1`, [args.cotizacion_ref]);
    const c = filas[0];
    if (!c) throw new Error(`No existe la cotización ${args.cotizacion_ref}`);
    const ordenCompra = (c.orden_compra ?? []) as OrdenCompraLinea[];

    // El agente le avisa a repuestos que terminamos: lo usado se entrega (y se nos vende, total con
    // IVA) y lo apartado de más lo libera él. Best-effort: un fallo aquí no debe bloquear el cobro
    // al cliente, que es la responsabilidad central de Ventas (el agente lo deja en el log).
    let pedidoRepuestos: PedidoT | null = null;
    if (ordenCompra.length > 0) {
      const usadas = ordenCompra
        .map((o) => ({ codigo_repuesto: o.codigo_repuesto, cantidad: args.partes_usadas.find((p) => p.codigo_repuesto === o.codigo_repuesto)?.cantidad ?? 0 }))
        .filter((u) => u.cantidad > 0);
      try {
        const r = await this.agente.ejecutar({
          tipo: 'terminada', codigo_orden: args.codigo, hablar: true, repuestos: usadas,
          id_repuestos: `fac-${args.id_mensaje}-entregar`,
          hechos: { el_taller: 'terminó la reparación', repuestos_usados: usadas, repuestos_apartados: ordenCompra.map((o) => ({ codigo_repuesto: o.codigo_repuesto, cantidad: o.cantidad })) },
        });
        pedidoRepuestos = r.pedido;
      } catch (e) {
        this.logger.error(`No se pudo cerrar el pedido de repuestos de ${args.codigo}: ${(e as Error).message}`);
      }
    }

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

    // Control cruzado: lo que la tienda dice que le debemos (total con IVA) contra lo que nosotros
    // calculamos con sus mismos precios sin IVA. Si no cuadran, se deja en el log para revisión.
    if (pedidoRepuestos) {
      // La tienda nos vende TODO lo usado (también lo cubierto por garantía), no solo lo del cliente.
      const nuestro = args.partes_usadas.reduce((s, p) => {
        const compra = ordenCompra.find((o) => o.codigo_repuesto === p.codigo_repuesto);
        return compra ? s + Math.round(p.cantidad * compra.precio_unitario * 1.19) : s;
      }, 0);
      if (Math.abs(nuestro - pedidoRepuestos.total_a_cobrar_con_iva) > 5) {
        this.logger.warn(`Orden ${args.codigo}: la tienda nos cobra $${pedidoRepuestos.total_a_cobrar_con_iva} con IVA y nuestro cálculo de lo usado da $${nuestro}. Revisar cantidades o precios.`);
      }
    }

    await this.db.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO pagos_pse (referencia_pse, codigo, cotizacion_ref, valor, lineas_cobro, id_mensaje_entrada) VALUES ($1,$2,$3,$4,$5,$6)`,
        [referencia_pse, args.codigo, args.cotizacion_ref, totales.total, JSON.stringify(lineasCalculo), args.id_mensaje],
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

    // Liquida sobre lo que REALMENTE se cobró (lineas_cobro, calculado y guardado en
    // recibirReparacionTerminada a partir de mano_obra_realizada/partes_usadas), no sobre la
    // cotización original: el taller puede terminar usando menos repuestos de los cotizados.
    const lineas = pago.lineas_cobro as LineaParaCalculo[];
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

    // Con el pago del cliente ya recibido, el agente avisa al taller y, si la orden tuvo repuestos,
    // le informa a la tienda que pagamos (con la referencia PSE). El orden lo decide el agente.
    const hayRepuestos = lineas.some((l) => l.beneficiario === 'tienda');
    await this.agente.ejecutar({
      tipo: 'pagada', codigo_orden: pago.codigo, hablar: hayRepuestos, repuestos: [], referencia_pse,
      id_repuestos: `fac-${referencia_pse}-pagar-repuestos`,
      taller: { herramienta: 'registrar_pago', args: { codigo: pago.codigo, referencia_pse, valor: pago.valor, id_mensaje: `fac-${referencia_pse}-pago` } },
      hechos: { el_cliente: 'pagó por PSE', referencia_pse, la_orden_tuvo_repuestos: hayRepuestos },
    });
    this.logger.log(`Pago ${referencia_pse} confirmado, orden ${pago.codigo}: venta interna ${venta_id} liquidada (cuadra=${liquidacion.cuadra})`);
  }
}
