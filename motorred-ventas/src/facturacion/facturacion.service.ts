import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { MENSAJES } from '../config.js';
import { DineroService, type LineaParaCalculo } from '../negocio/dinero.service.js';
import { ParametrosService } from '../negocio/parametros.service.js';
import { AgenteFacturacionService } from './agente-facturacion.service.js';
import { ClienteTallerReal } from './cliente-taller.js';
import type { DatosComprobante } from './comprobante-pdf.js';
import { redactarCotizacion, type LineaManoObra, type LineaRepuesto } from './mensaje-cotizacion.js';
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

  // Acuse inmediato + trabajo en segundo plano. El taller corta a ~70 s y repuestos puede tardar más
  // (o no responder), así que respondemos {recibido:true} al validar y seguimos solos. Un reintento
  // con el mismo id_mensaje mientras el primero sigue en curso se ignora; si el trabajo falla, el id
  // no queda marcado y un reintento lo vuelve a procesar.
  private readonly enCurso = new Set<string>();

  private enSegundoPlano(id_mensaje: string, etiqueta: string, trabajo: () => Promise<unknown>): { recibido: boolean } {
    if (this.enCurso.has(id_mensaje)) return { recibido: true };
    this.enCurso.add(id_mensaje);
    void trabajo()
      .catch((e) => this.logger.error(`${etiqueta} (${id_mensaje}) falló en segundo plano: ${e instanceof Error ? e.message : e}`))
      .finally(() => this.enCurso.delete(id_mensaje));
    return { recibido: true };
  }

  aceptarCotizacion(args: CrearCotizacionInputT): { recibido: boolean } {
    return this.enSegundoPlano(args.id_mensaje, `crear_cotizacion ${args.codigo}`, () => this.recibirCotizacion(args));
  }

  aceptarReparacionTerminada(args: NotificarReparacionTerminadaInputT): { recibido: boolean } {
    return this.enSegundoPlano(args.id_mensaje, `notificar_reparacion_terminada ${args.codigo}`, () => this.recibirReparacionTerminada(args));
  }

  // Respuesta del cliente que nos devuelve AutoMax (registrar_respuesta_cotizacion). Acuse al
  // instante: pedir los repuestos y avisar al taller puede tardar más de los 30 s que AutoMax espera.
  // Idempotente por id_mensaje (conc-aviso-<id>-respuesta): un reintento no repite la compra.
  async registrarRespuestaCotizacion(a: { cotizacion_ref: string; aceptada: boolean; motivo?: string; canal?: string; id_mensaje: string }): Promise<{ recibido: boolean }> {
    if ((await this.yaProcesado(a.id_mensaje)) || this.enCurso.has(a.id_mensaje)) return { recibido: true };
    const filas = await this.db.query(`SELECT codigo, estado FROM cotizaciones WHERE cotizacion_ref = $1`, [a.cotizacion_ref]);
    if (!filas[0]) throw new Error(`No existe la cotización ${a.cotizacion_ref}`);
    if (filas[0].estado !== 'pendiente_respuesta') throw new Error(`La cotización ${a.cotizacion_ref} ya fue respondida`);
    return this.enSegundoPlano(a.id_mensaje, `respuesta de cotización ${a.cotizacion_ref}`, async () => {
      await this.clienteRespondioCotizacion(a.cotizacion_ref, a.aceptada, a.motivo);
      await this.marcarProcesado(a.id_mensaje, 'registrar_respuesta_cotizacion', filas[0].codigo as string);
    });
  }

  // Reenvía el aviso de una cotización YA guardada (p. ej. AutoMax estaba caído cuando se creó).
  // Reconstruye el mensaje con los datos guardados y usa el mismo id_mensaje que el envío original:
  // si AutoMax ya lo había entregado, no le llega repetido al cliente. Solo para cotizaciones pendientes.
  async reenviarAvisoCotizacion(cotizacion_ref: string): Promise<{ reenviado: boolean; total_a_pagar: number }> {
    const filas = await this.db.query(`SELECT * FROM cotizaciones WHERE cotizacion_ref = $1`, [cotizacion_ref]);
    const c = filas[0];
    if (!c) throw new Error(`No existe la cotización ${cotizacion_ref}`);
    if (c.estado !== 'pendiente_respuesta') throw new Error(`La cotización ${cotizacion_ref} ya está ${c.estado}`);
    const cliente = c.cliente as { cedula: string; nombre: string; telefono: string };
    const vehiculo = c.vehiculo as { descripcion: string; placa: string };
    const { mensaje, total: total_a_pagar } = redactarCotizacion({
      cliente: cliente.nombre, vehiculo: vehiculo.descripcion, placa: vehiculo.placa, codigo: c.codigo as string, cotizacion_ref,
      manoObra: c.mano_obra as LineaManoObra[], repuestos: c.repuestos as LineaRepuesto[],
    }, this.dinero, { negrita: MENSAJES.negrita });
    await this.telegram.enviarCotizacion({
      id_relacion: c.id_relacion as string, cotizacion_ref, codigo: c.codigo as string, cliente, total_a_pagar, mensaje,
    });
    return { reenviado: true, total_a_pagar };
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

    // Lo que ve el cliente es el total CON IVA, calculado igual que el cobro por PSE (mismo
    // DineroService), para que no acepte un valor y pague otro. Las cifras salen de este código,
    // nunca de un modelo ni del agente que entregue el mensaje.
    const { mensaje, total: total_a_pagar } = redactarCotizacion({
      cliente: args.cliente.nombre, vehiculo: args.vehiculo.descripcion, placa: args.vehiculo.placa, codigo: args.codigo, cotizacion_ref,
      manoObra: args.mano_obra,
      repuestos: repuestosConPrecio.map((r) => ({ descripcion: r.linea.descripcion, cantidad: r.linea.cantidad, precio_unitario: r.precio_unitario, garantia: r.linea.garantia })),
    }, this.dinero, { negrita: MENSAJES.negrita });
    await this.telegram.enviarCotizacion({
      id_relacion: args.id_relacion, cotizacion_ref, codigo: args.codigo, cliente: args.cliente, total_a_pagar, mensaje,
    });
    this.logger.log(`Cotización ${cotizacion_ref} (orden ${args.codigo}) creada: mano de obra cliente $${total_mano_obra_cliente}, repuestos cliente $${total_repuestos_cliente} (sin IVA); total al cliente con IVA $${total_a_pagar}`);
    return { recibido: true };
  }

  private redactarMensajeGarantia(args: CrearCotizacionInputT): string {
    const cubiertas = [...args.mano_obra, ...args.repuestos].filter((l) => l.garantia.valida);
    if (cubiertas.length === 0) {
      // Si el taller evaluó la garantía y no procede (p. ej. vencida), el cliente debe saber por qué
      // paga: se muestra el motivo que dio el taller, sin inventar nada.
      const motivos = [...new Set([...args.mano_obra, ...args.repuestos].filter((l) => l.garantia.aplica && l.garantia.motivo).map((l) => l.garantia.motivo.trim().replace(/[.\s]+$/, '').slice(0, 160)))];
      return motivos.length
        ? `Ningún ítem de esta cotización quedó cubierto por garantía: ${motivos.join('; ')}.`
        : 'Ningún ítem de esta cotización quedó cubierto por garantía.';
    }
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
      id_relacion: c.id_relacion as string, cotizacion_ref: args.cotizacion_ref, codigo: args.codigo, cliente, referencia_pse, valor: totales.total, url_pago: url,
      mensaje: `Hola ${cliente.nombre}, tu reparación (orden ${args.codigo}) está lista. Total a pagar: $${totales.total.toLocaleString('es-CO')} (IVA incluido). Ref. ${args.cotizacion_ref}. Usa el botón para pagar con PSE.`,
    });
    this.logger.log(`Reparación terminada, orden ${args.codigo}: PSE ${referencia_pse} por $${totales.total}`);
    return { recibido: true };
  }

  // Reenvía el aviso de pago de una reparación terminada (p. ej. para entregar el enlace nuevo de la
  // pasarela). El id_mensaje depende del enlace: el mismo enlace no se repite, uno distinto sí sale.
  async reenviarAvisoPago(referencia_pse: string): Promise<{ reenviado: boolean; valor: number; url_pago: string }> {
    const filas = await this.db.query(
      `SELECT p.referencia_pse, p.codigo, p.cotizacion_ref, p.valor, p.estado, c.id_relacion, c.cliente FROM pagos_pse p JOIN cotizaciones c ON c.cotizacion_ref = p.cotizacion_ref WHERE p.referencia_pse = $1`,
      [referencia_pse],
    );
    const f = filas[0];
    if (!f) throw new Error(`No existe el pago ${referencia_pse}`);
    if (f.estado !== 'pendiente') throw new Error(`El pago ${referencia_pse} ya está ${f.estado}`);
    const valor = Number(f.valor);
    const cliente = f.cliente as { telefono: string; nombre: string };
    const url_pago = await this.pse.enlacePago(referencia_pse, valor);
    await this.telegram.enviarPse({
      id_relacion: f.id_relacion as string, cotizacion_ref: f.cotizacion_ref as string, codigo: f.codigo as string, cliente, referencia_pse, valor, url_pago,
      mensaje: `Hola ${cliente.nombre}, tu reparación (orden ${f.codigo}) está lista. Total a pagar: $${valor.toLocaleString('es-CO')} (IVA incluido). Ref. ${f.cotizacion_ref}. Usa el botón para pagar con PSE.`,
    });
    return { reenviado: true, valor, url_pago };
  }

  // Datos para la página de pago simulada (monto, orden, cliente y estado del pago).
  async datosPago(referencia_pse: string): Promise<{ referencia_pse: string; codigo: string; valor: number; estado: string; cliente: string; creado_en: Date } | null> {
    const filas = await this.db.query(
      `SELECT p.referencia_pse, p.codigo, p.valor, p.estado, p.creado_en, c.cliente FROM pagos_pse p LEFT JOIN cotizaciones c ON c.cotizacion_ref = p.cotizacion_ref WHERE p.referencia_pse = $1`,
      [referencia_pse],
    );
    const f = filas[0];
    if (!f) return null;
    return { referencia_pse: f.referencia_pse, codigo: f.codigo, valor: Number(f.valor), estado: f.estado, creado_en: new Date(f.creado_en), cliente: (f.cliente as { nombre?: string } | null)?.nombre ?? '' };
  }

  // Datos del comprobante: solo para pagos CONFIRMADOS. Los montos salen de las líneas que realmente
  // se cobraron (las mismas que usó la liquidación), no de la cotización original.
  async datosComprobante(referencia_pse: string): Promise<DatosComprobante | null> {
    const filas = await this.db.query(
      `SELECT p.referencia_pse, p.codigo, p.valor, p.estado, p.lineas_cobro, c.cliente, c.venta_id, v.creada_en
       FROM pagos_pse p JOIN cotizaciones c ON c.cotizacion_ref = p.cotizacion_ref LEFT JOIN ventas v ON v.venta_id = c.venta_id
       WHERE p.referencia_pse = $1`,
      [referencia_pse],
    );
    const f = filas[0];
    if (!f || f.estado !== 'confirmado') return null;
    const lineas = f.lineas_cobro as LineaParaCalculo[];
    const base = (concepto: string) => lineas.filter((l) => l.concepto === concepto).reduce((s, l) => s + l.cantidad * l.precio_unitario, 0);
    const t = this.dinero.totales(lineas);
    return {
      referencia_pse: f.referencia_pse, codigo: f.codigo, cliente: (f.cliente as { nombre?: string } | null)?.nombre ?? '',
      fecha: new Date(f.creada_en ?? Date.now()), servicios: base('servicio'), repuestos: base('repuesto'),
      subtotal: t.subtotal, iva: t.iva, total: Number(f.valor), venta_id: (f.venta_id as string | null) ?? null,
    };
  }

  // El cliente quiere volver a intentar un pago que rechazó: vuelve a 'pendiente' (mismo monto y
  // referencia). Solo desde 'rechazado'; un pago confirmado nunca se reabre.
  async reabrirPago(referencia_pse: string): Promise<boolean> {
    const r = (await this.db.query(`UPDATE pagos_pse SET estado = 'pendiente' WHERE referencia_pse = $1 AND estado = 'rechazado' RETURNING 1`, [referencia_pse])) as unknown[];
    const reabierto = Array.isArray(r) && (Array.isArray(r[0]) ? r[0].length > 0 : r.length > 0);
    if (reabierto) this.logger.log(`Pago ${referencia_pse} reabierto: el cliente vuelve a intentar`);
    return reabierto;
  }

  // El cliente rechazó/canceló el pago en la pasarela. Es definitivo, como en la pasarela del kit:
  // para volver a intentar se necesita un enlace nuevo. No mueve dinero ni avisa a repuestos.
  async rechazarPago(referencia_pse: string): Promise<boolean> {
    const r = (await this.db.query(`UPDATE pagos_pse SET estado = 'rechazado' WHERE referencia_pse = $1 AND estado = 'pendiente' RETURNING 1`, [referencia_pse])) as unknown[];
    const rechazado = Array.isArray(r) && (Array.isArray(r[0]) ? r[0].length > 0 : r.length > 0);
    if (rechazado) this.logger.warn(`Pago ${referencia_pse} rechazado por el cliente en la pasarela`);
    return rechazado;
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
