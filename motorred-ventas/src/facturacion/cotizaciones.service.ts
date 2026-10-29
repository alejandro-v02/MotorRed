import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { z } from 'zod';
import { FACTURACION } from '../config.js';
import type { CrearCotizacionEntrada, NotificarReparacionEntrada } from '../contrato/facturacion.js';
import { CotizacionEntity } from '../db/entidades/cotizacion.entity.js';
import { LineaCotizacionEntity } from '../db/entidades/linea-cotizacion.entity.js';
import type { VentaEntity } from '../db/entidades/venta.entity.js';
import { BitacoraService } from '../mcp/bitacora.service.js';
import { DineroService, type LineaParaCalculo } from '../negocio/dinero.service.js';
import { ErrorNegocio } from '../negocio/errores.js';
import { ParametrosService } from '../negocio/parametros.service.js';
import { VentasService } from '../negocio/ventas.service.js';
import {
  PUERTO_NOTIFICACIONES, PUERTO_PRECIOS, type OfertaRepuesto, type ProveedorRepuesto, type PuertoNotificaciones, type PuertoPrecios,
} from './puertos.js';
import { SalidaService } from './salida.service.js';

type CrearCotizacionIn = z.infer<typeof CrearCotizacionEntrada>;
type NotificarReparacionIn = z.infer<typeof NotificarReparacionEntrada>;

const ESTADOS_COBRO_ABIERTO = ['en_cobro', 'pagada', 'liquidada', 'en_revision'];
const dinero = (n: number) => `$${n.toLocaleString('es-CO')}`;
const huella = (obj: unknown) => createHash('sha256').update(JSON.stringify(obj)).digest('hex');

// Facturación: cotiza lo que el Taller diagnosticó, espera la decisión del cliente, compra los
// repuestos y, cuando la reparación termina, cobra lo realmente hecho reutilizando la venta, la
// saga de pago, la liquidación y los asientos de VentasService. Los montos los calcula el código
// (DineroService); el cliente decide por /internos/cotizaciones/:codigo/respuesta y ningún agente
// de IA mueve dinero ni cambia un estado.
@Injectable()
export class CotizacionesService implements OnModuleInit, OnModuleDestroy {
  private temporizador: NodeJS.Timeout | null = null;
  private readonly cola = new Map<string, Promise<unknown>>();

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(PUERTO_PRECIOS) private readonly precios: PuertoPrecios,
    @Inject(PUERTO_NOTIFICACIONES) private readonly notificador: PuertoNotificaciones,
    private readonly dinero: DineroService,
    private readonly parametros: ParametrosService,
    private readonly ventas: VentasService,
    private readonly salida: SalidaService,
    private readonly bitacora: BitacoraService,
  ) {}

  onModuleInit(): void {
    this.ventas.alCambiar((venta, evento) => this.alCambiarVenta(venta, evento));
    this.temporizador = setInterval(() => void this.vencerExpiradas().catch(() => {}), 60_000);
    this.temporizador.unref();
  }

  onModuleDestroy(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  // ------------------------------------------------------------------ utilidades ----

  private get cots() {
    return this.db.getRepository(CotizacionEntity);
  }

  private get lins() {
    return this.db.getRepository(LineaCotizacionEntity);
  }

  // Una orden a la vez dentro de este proceso: dos llamadas simultáneas sobre el mismo código no se pisan.
  private serializar<T>(codigo: string, fn: () => Promise<T>): Promise<T> {
    const anterior = this.cola.get(codigo) ?? Promise.resolve();
    const siguiente = anterior.then(fn);
    this.cola.set(codigo, siguiente.catch(() => undefined));
    return siguiente;
  }

  private normalizar(codigo: string): string {
    return codigo.trim().toUpperCase();
  }

  private async cargar(codigo: string): Promise<CotizacionEntity> {
    const c = await this.cots.findOne({ where: { codigo }, relations: ['lineas'], order: { lineas: { id: 'ASC' } } });
    if (!c) throw new ErrorNegocio('NO_ENCONTRADO', `No existe una cotización para la orden ${codigo}`);
    return c;
  }

  // Quién paga una línea: solo si el mecánico dijo que aplica la garantía Y el concesionario la validó,
  // paga el tercero que indica la garantía; en cualquier otro caso paga el cliente.
  private pagadorEfectivo(g: { aplica: boolean; valida: boolean | null; pagador: string } | undefined): string {
    return g && g.aplica && g.valida === true ? g.pagador : 'cliente';
  }

  private paraCalculo(lineas: LineaCotizacionEntity[], cantidades?: Map<number, number>): LineaParaCalculo[] {
    return lineas.map((l) => ({
      beneficiario: l.tipo === 'mano_obra' ? 'taller' : (l.proveedor ?? 'tienda'),
      concepto: l.tipo === 'mano_obra' ? 'servicio' : 'repuesto',
      cantidad: cantidades?.get(l.id) ?? l.cantidad,
      precio_unitario: l.precio_unitario ?? 0,
      iva_porcentaje: Number(l.iva_porcentaje),
    }));
  }

  // total = todo; total_cliente = lo que paga el cliente (menos retención si es agente de retención).
  private async totales(lineas: LineaCotizacionEntity[], cantidades?: Map<number, number>) {
    const todas = this.dinero.totales(this.paraCalculo(lineas, cantidades));
    const delCliente = lineas.filter((l) => l.pagador === 'cliente');
    const propias = this.paraCalculo(delCliente, cantidades);
    const bruto = this.dinero.totales(propias);
    const params = await this.parametros.actuales();
    const retencion = Object.values(this.dinero.retenciones(propias, { tipo: 'cliente', retenedor: FACTURACION.clienteRetenedor }, params)).reduce((s, x) => s + x, 0);
    const total_cliente = bruto.total - retencion;
    return { subtotal: todas.subtotal, iva: todas.iva, total: todas.total, total_cliente, total_cubierto_garantia: todas.total - bruto.total };
  }

  private acuse(c: CotizacionEntity) {
    const mensajes: Record<string, string> = {
      recibida: 'Cotización recibida: se están buscando los precios de los repuestos',
      cotizada: 'Cotización lista: se le avisó al cliente y se espera su respuesta',
      aceptada: 'El cliente aceptó la cotización',
      rechazada: 'El cliente rechazó la cotización',
      vencida: 'La cotización venció sin respuesta del cliente',
      cancelada: 'La cotización fue cancelada',
      sin_precio: 'No se pudo cotizar algún repuesto: una persona debe revisar',
      en_cobro: 'Reparación recibida: se envió el cobro al cliente',
      pagada: 'El pago fue confirmado',
      liquidada: 'El pago fue confirmado y el dinero repartido',
      en_revision: 'Algo no cuadró: una persona debe revisar',
    };
    return { codigo: c.codigo, cotizacion_ref: c.cotizacion_ref, traza_id: c.traza_id, estado: c.estado as never, mensaje: mensajes[c.estado] ?? c.estado };
  }

  private async avisar(c: CotizacionEntity, texto: string): Promise<void> {
    try {
      await this.notificador.avisarCliente({ traza_id: c.traza_id, codigo: c.codigo, telefono: c.cliente.telefono, nombre: c.cliente.nombre, texto });
    } catch (e) {
      // El aviso es un canal, no la decisión: si falla, la cotización sigue viva y el error queda en la bitácora.
      this.bitacora.registrar({ traza_id: c.traza_id, evento: 'aviso_cliente_fallido', ok: false, codigo: c.codigo, error: (e as Error).message });
    }
  }

  // ------------------------------------------------------------ 1. crear_cotizacion ----

  async crearCotizacion(args: CrearCotizacionIn, _cliente: string) {
    const codigo = this.normalizar(args.codigo);
    const { responder_con: _responder, ...sinRespuesta } = args;
    const h = huella({ ...sinRespuesta, codigo });
    return this.serializar(codigo, async () => {
      const previa = await this.cots.findOne({ where: { codigo } });
      if (previa) {
        if (previa.huella !== h) throw new ErrorNegocio('IDEMPOTENCIA_CONFLICTO', `La orden ${codigo} ya tiene una cotización con otros datos`);
        return this.acuse(previa);
      }
      if (args.hay_repuestos !== args.repuestos.length > 0) throw new ErrorNegocio('DATOS_INVALIDOS', 'hay_repuestos no coincide con la lista de repuestos');
      if (!args.mano_obra.length && !args.repuestos.length) throw new ErrorNegocio('DATOS_INVALIDOS', 'La cotización no tiene mano de obra ni repuestos');
      const sumaMano = args.mano_obra.reduce((s, l) => s + l.precio, 0);
      if (sumaMano !== args.total_mano_obra) throw new ErrorNegocio('DATOS_INVALIDOS', `total_mano_obra dice ${args.total_mano_obra} y las líneas suman ${sumaMano}`);

      const params = await this.parametros.actuales();
      const traza_id = randomUUID();
      const cotizacion_ref = `FAC-${codigo}`;
      const manoCliente = args.mano_obra.filter((l) => this.pagadorEfectivo(l.garantia) === 'cliente').reduce((s, l) => s + l.precio, 0);
      // El Excel del Taller no aclara cómo calcula total_mano_obra_cliente (con o sin IVA). Se usa el
      // cálculo propio y se deja constancia si difiere: pendiente de confirmar (docs/pendientes-contratos.md).
      if (manoCliente !== args.total_mano_obra_cliente) {
        this.bitacora.registrar({ traza_id, evento: 'total_mano_obra_cliente_difiere', ok: true, codigo, enviado: args.total_mano_obra_cliente, calculado: manoCliente });
      }

      await this.db.transaction(async (m) => {
        await m.insert(CotizacionEntity, {
          cotizacion_ref, codigo, traza_id, id_relacion: args.id_relacion, taller: args.taller ?? null, sede: args.sede ?? null,
          cliente: args.cliente, vehiculo: args.vehiculo, estado: 'recibida', mensaje_garantia: args.mensaje_garantia ?? null, huella: h,
        });
        const lineas: Partial<LineaCotizacionEntity>[] = [
          ...args.mano_obra.map((l) => ({
            cotizacion_ref, tarea_id: l.tarea_id, tipo: 'mano_obra', referencia: l.sku, descripcion: l.descripcion, cantidad: 1,
            precio_unitario: l.precio, iva_porcentaje: params.iva_porcentaje, pagador: this.pagadorEfectivo(l.garantia), garantia: l.garantia as never, estado: 'cotizada',
          })),
          ...args.repuestos.map((l) => ({
            cotizacion_ref, tarea_id: l.tarea_id, tipo: 'repuesto', referencia: l.codigo_repuesto, descripcion: l.descripcion, cantidad: l.cantidad,
            precio_unitario: null, iva_porcentaje: params.iva_porcentaje, pagador: this.pagadorEfectivo(l.garantia), garantia: (l.garantia ?? null) as never, estado: 'pendiente_precio',
          })),
        ];
        await m.insert(LineaCotizacionEntity, lineas as never);
      });
      this.bitacora.registrar({ traza_id, evento: 'cotizacion_recibida', ok: true, codigo, cotizacion_ref });
      setImmediate(() => void this.serializar(codigo, () => this.cotizar(codigo)).catch((e) => this.bitacora.registrar({ traza_id, evento: 'error_no_manejado', ok: false, codigo, error: (e as Error).message })));
      return this.acuse(await this.cargar(codigo));
    });
  }

  // Busca el precio de cada repuesto, calcula los totales y le avisa al cliente.
  private async cotizar(codigo: string): Promise<void> {
    const c = await this.cargar(codigo);
    if (c.estado !== 'recibida') return;
    const params = await this.parametros.actuales();
    const fallos: string[] = [];
    for (const l of c.lineas.filter((x) => x.tipo === 'repuesto')) {
      try {
        const oferta = await this.precios.cotizar(c.traza_id, { codigo_repuesto: l.referencia, cantidad: l.cantidad });
        if (!oferta) {
          l.estado = 'sin_stock';
          fallos.push(`${l.referencia}: sin existencias`);
        } else {
          Object.assign(l, { precio_unitario: oferta.precio_unitario, iva_porcentaje: oferta.iva_porcentaje ?? params.iva_porcentaje, proveedor: oferta.proveedor, tienda: oferta.tienda, oferta_ref: oferta.oferta_ref, estado: 'cotizada' });
        }
      } catch (e) {
        l.estado = 'sin_precio';
        fallos.push(`${l.referencia}: ${(e as Error).message}`);
      }
      await this.lins.update({ id: l.id }, { precio_unitario: l.precio_unitario, iva_porcentaje: l.iva_porcentaje, proveedor: l.proveedor, tienda: l.tienda, oferta_ref: l.oferta_ref, estado: l.estado });
    }
    if (fallos.length) {
      // El Excel del Taller no tiene una herramienta para avisar "no hay repuestos": queda para una
      // persona (pendiente de decidir con el grupo Falla, ver docs/pendientes-contratos.md).
      await this.cots.update({ cotizacion_ref: c.cotizacion_ref }, { estado: 'sin_precio', motivo: fallos.join('; ') });
      this.bitacora.registrar({ traza_id: c.traza_id, evento: 'cotizacion_sin_precio', ok: false, codigo, motivo: fallos.join('; ') });
      return;
    }
    const t = await this.totales(c.lineas);
    const vence_en = new Date(Date.now() + FACTURACION.vigenciaHoras * 3_600_000);
    await this.cots.update({ cotizacion_ref: c.cotizacion_ref }, { ...t, vence_en, estado: 'cotizada', motivo: null });
    this.bitacora.registrar({ traza_id: c.traza_id, evento: 'cotizacion_lista', ok: true, codigo, total: t.total, total_cliente: t.total_cliente });
    await this.avisar(c, [
      `Hola ${c.cliente.nombre}, esta es la cotización ${c.cotizacion_ref} para su vehículo ${c.vehiculo.placa} (${c.vehiculo.descripcion}).`,
      `Total a pagar: ${dinero(t.total_cliente)} (IVA incluido).`,
      t.total_cubierto_garantia > 0 ? `La garantía cubre ${dinero(t.total_cubierto_garantia)}.` : '',
      c.mensaje_garantia ?? '',
      `Responda ACEPTO o RECHAZO antes del ${vence_en.toLocaleString('es-CO', { timeZone: 'America/Bogota' })}.`,
    ].filter(Boolean).join(' '));
  }

  // ------------------------------------------------ 2. respuesta del cliente ----

  // Único punto de entrada de la decisión del cliente (el bot de Telegram, la app o un operador).
  async responderCliente(codigoEntrada: string, datos: { aceptada: boolean; motivo?: string }) {
    const codigo = this.normalizar(codigoEntrada);
    return this.serializar(codigo, async () => {
      const c = await this.cargar(codigo);
      if (c.estado === 'aceptada' && datos.aceptada) return this.acuse(c);
      if (c.estado === 'rechazada' && !datos.aceptada) return this.acuse(c);
      if (c.estado !== 'cotizada') throw new ErrorNegocio('ESTADO_INVALIDO', `La cotización de ${codigo} está ${c.estado}: ya no espera la respuesta del cliente`);
      if (c.vence_en && c.vence_en.getTime() < Date.now()) {
        await this.marcarVencida(c);
        throw new ErrorNegocio('ESTADO_INVALIDO', `La cotización de ${codigo} venció`);
      }
      const id_mensaje = `fac-${c.cotizacion_ref}-respuesta`;

      if (!datos.aceptada) {
        await this.cots.update({ cotizacion_ref: c.cotizacion_ref }, { estado: 'rechazada', motivo: datos.motivo ?? null });
        await this.salida.encolarParaTaller({ id_mensaje, tipo: 'registrar_respuesta_cliente', traza_id: c.traza_id, codigo, payload: { codigo, aceptada: false, motivo: datos.motivo, referencia: c.cotizacion_ref, id_mensaje } });
        return this.acuse(await this.cargar(codigo));
      }

      // Aceptó: se compran los repuestos con el precio cotizado. Si algo falla, se deshace lo comprado.
      const compradas: LineaCotizacionEntity[] = [];
      try {
        for (const l of c.lineas.filter((x) => x.tipo === 'repuesto')) {
          const oferta: OfertaRepuesto = { oferta_ref: l.oferta_ref!, proveedor: l.proveedor as ProveedorRepuesto, tienda: l.tienda!, precio_unitario: l.precio_unitario!, iva_porcentaje: Number(l.iva_porcentaje), stock: 0 };
          const compra = await this.precios.comprar(c.traza_id, `${c.cotizacion_ref}|${l.id}`, oferta, l.cantidad);
          l.compra_ref = compra.compra_ref;
          compradas.push(l);
          if (compra.precio_unitario !== l.precio_unitario) {
            throw new ErrorNegocio('PRECIO_NO_COINCIDE', `${l.referencia}: se cotizó a ${l.precio_unitario} y la tienda cobra ${compra.precio_unitario}`);
          }
          await this.lins.update({ id: l.id }, { compra_ref: compra.compra_ref, estado: 'comprada' });
        }
      } catch (e) {
        for (const l of compradas) {
          await this.precios.liberar(c.traza_id, l.compra_ref!, `Compensación de ${c.cotizacion_ref}: ${(e as Error).message}`).catch((x) => this.bitacora.registrar({ traza_id: c.traza_id, evento: 'compensacion_fallida', ok: false, codigo, compra_ref: l.compra_ref, error: (x as Error).message }));
          await this.lins.update({ id: l.id }, { compra_ref: null, estado: 'cotizada' });
        }
        const reintentable = e instanceof ErrorNegocio && e.reintentable;
        if (!reintentable) await this.cots.update({ cotizacion_ref: c.cotizacion_ref }, { estado: 'sin_precio', motivo: `La compra falló: ${(e as Error).message}` });
        this.bitacora.registrar({ traza_id: c.traza_id, evento: 'saga_compensacion', ok: false, codigo, motivo: (e as Error).message });
        throw e;
      }

      await this.cots.update({ cotizacion_ref: c.cotizacion_ref }, { estado: 'aceptada', motivo: null });
      const orden_compra = (await this.cargar(codigo)).lineas.filter((l) => l.tipo === 'repuesto').map((l) => ({
        codigo_repuesto: l.referencia, descripcion: l.descripcion, cantidad: l.cantidad, tienda: l.tienda!, precio_unitario: l.precio_unitario!, pagador: l.pagador,
      }));
      await this.salida.encolarParaTaller({ id_mensaje, tipo: 'registrar_respuesta_cliente', traza_id: c.traza_id, codigo, payload: { codigo, aceptada: true, referencia: c.cotizacion_ref, orden_compra, id_mensaje } });
      return this.acuse(await this.cargar(codigo));
    });
  }

  private async marcarVencida(c: CotizacionEntity): Promise<void> {
    const r = await this.cots.update({ cotizacion_ref: c.cotizacion_ref, estado: 'cotizada' }, { estado: 'vencida', motivo: 'La cotización venció sin respuesta del cliente' });
    if (!r.affected) return;
    const id_mensaje = `fac-${c.cotizacion_ref}-respuesta`;
    await this.salida.encolarParaTaller({ id_mensaje, tipo: 'registrar_respuesta_cliente', traza_id: c.traza_id, codigo: c.codigo, payload: { codigo: c.codigo, aceptada: false, motivo: 'La cotización venció sin respuesta del cliente', referencia: c.cotizacion_ref, id_mensaje } });
    this.bitacora.registrar({ traza_id: c.traza_id, evento: 'cotizacion_vencida', ok: true, codigo: c.codigo });
  }

  async vencerExpiradas(): Promise<number> {
    const filas: { codigo: string }[] = await this.db.query(`SELECT codigo FROM cotizaciones WHERE estado = 'cotizada' AND vence_en < now()`);
    for (const f of filas) await this.serializar(f.codigo, async () => this.marcarVencida(await this.cargar(f.codigo)));
    return filas.length;
  }

  // ----------------------------------------- 3. notificar_reparacion_terminada ----

  async notificarReparacionTerminada(args: NotificarReparacionIn, _cliente: string) {
    const codigo = this.normalizar(args.codigo);
    return this.serializar(codigo, async () => {
      const c = await this.cargar(codigo);
      if (c.cotizacion_ref !== args.cotizacion_ref) throw new ErrorNegocio('NO_ENCONTRADO', `La referencia ${args.cotizacion_ref} no corresponde a la orden ${codigo}`);
      if (ESTADOS_COBRO_ABIERTO.includes(c.estado)) return this.acuse(c); // idempotente
      if (c.estado !== 'aceptada') throw new ErrorNegocio('ESTADO_INVALIDO', `La cotización de ${codigo} está ${c.estado}: solo se cobra una reparación aceptada`);

      // 1. La mano de obra realizada debe ser la cotizada, con el mismo precio (nadie cobra otro valor).
      const mano = c.lineas.filter((l) => l.tipo === 'mano_obra');
      const hechas = new Set<number>();
      for (const r of args.mano_obra_realizada) {
        const l = mano.find((x) => x.tarea_id === r.tarea_id && x.referencia === r.sku);
        if (!l) throw new ErrorNegocio('DATOS_INVALIDOS', `El servicio ${r.sku} (tarea ${r.tarea_id}) no estaba en la cotización`);
        if (l.precio_unitario !== r.precio) throw new ErrorNegocio('PRECIO_NO_COINCIDE', `${r.sku}: se cotizó a ${l.precio_unitario} y el taller informa ${r.precio}`);
        hechas.add(l.id);
      }
      const sumaHecha = args.mano_obra_realizada.reduce((s, r) => s + r.precio, 0);
      if (sumaHecha !== args.total_mano_obra) throw new ErrorNegocio('DATOS_INVALIDOS', `total_mano_obra dice ${args.total_mano_obra} y los servicios realizados suman ${sumaHecha}`);

      // 2. Las partes usadas no pueden superar lo comprado. Se cobra lo usado; lo demás se devuelve.
      const restante = new Map<string, number>();
      for (const p of args.partes_usadas) restante.set(p.codigo_repuesto, (restante.get(p.codigo_repuesto) ?? 0) + p.cantidad);
      const compradoPor = new Map<string, number>();
      const repuestos = c.lineas.filter((l) => l.tipo === 'repuesto');
      for (const l of repuestos) compradoPor.set(l.referencia, (compradoPor.get(l.referencia) ?? 0) + l.cantidad);
      for (const [cod, usadas] of restante) {
        if (!compradoPor.has(cod)) throw new ErrorNegocio('DATOS_INVALIDOS', `El repuesto ${cod} no estaba en la cotización`);
        if (usadas > compradoPor.get(cod)!) throw new ErrorNegocio('DATOS_INVALIDOS', `${cod}: se usaron ${usadas} y se compraron ${compradoPor.get(cod)}`);
      }
      const usadasPorLinea = new Map<number, number>();
      for (const l of repuestos) {
        const toma = Math.min(l.cantidad, restante.get(l.referencia) ?? 0);
        usadasPorLinea.set(l.id, toma);
        restante.set(l.referencia, (restante.get(l.referencia) ?? 0) - toma);
      }

      // 3. Estado de cada línea y devolución de lo no usado.
      for (const l of mano) await this.lins.update({ id: l.id }, { estado: hechas.has(l.id) ? 'realizada' : 'no_realizada' });
      for (const l of repuestos) {
        if ((usadasPorLinea.get(l.id) ?? 0) > 0) continue;
        if (l.compra_ref) {
          await this.precios.liberar(c.traza_id, l.compra_ref, `Repuesto no usado en ${codigo}`).catch((e) => this.bitacora.registrar({ traza_id: c.traza_id, evento: 'devolucion_fallida', ok: false, codigo, compra_ref: l.compra_ref, error: (e as Error).message }));
        }
        await this.lins.update({ id: l.id }, { estado: 'liberada' });
      }

      // 4. Lo que paga el cliente: mano de obra realizada y repuestos usados cuyo pagador efectivo es el cliente.
      const lineasCobro = [
        ...mano.filter((l) => hechas.has(l.id) && l.pagador === 'cliente'),
        ...repuestos.filter((l) => (usadasPorLinea.get(l.id) ?? 0) > 0 && l.pagador === 'cliente'),
      ];
      const params = await this.parametros.actuales();
      const lineasVenta = lineasCobro.map((l) => ({
        beneficiario: (l.tipo === 'mano_obra' ? 'taller' : l.proveedor) as 'taller' | 'tienda' | 'concesionario',
        concepto: (l.tipo === 'mano_obra' ? 'servicio' : 'repuesto') as 'servicio' | 'repuesto',
        referencia: l.referencia, descripcion: l.descripcion,
        cantidad: l.tipo === 'mano_obra' ? 1 : usadasPorLinea.get(l.id)!,
        precio_unitario: l.precio_unitario!, iva_porcentaje: Number(l.iva_porcentaje) || params.iva_porcentaje, reserva_id: null,
      }));

      // Los totales de la cotización pasan a reflejar lo realmente hecho y usado.
      const cantidades = new Map<number, number>([...mano.map((l) => [l.id, 1] as const), ...usadasPorLinea]);
      const cobrables = [...mano.filter((l) => hechas.has(l.id)), ...repuestos.filter((l) => (usadasPorLinea.get(l.id) ?? 0) > 0)];
      await this.cots.update({ cotizacion_ref: c.cotizacion_ref }, await this.totales(cobrables, cantidades));

      // Nada que cobrarle al cliente (todo quedó en garantía): se informa pago por 0, como el ejemplo del Excel.
      if (!lineasVenta.length) {
        const id_mensaje = `fac-${c.cotizacion_ref}-pago`;
        await this.cots.update({ cotizacion_ref: c.cotizacion_ref }, { estado: 'pagada', pago_ref: `SIN-COBRO-${c.cotizacion_ref}` });
        await this.salida.encolarParaTaller({ id_mensaje, tipo: 'registrar_pago', traza_id: c.traza_id, codigo, payload: { codigo, referencia_pse: `SIN-COBRO-${c.cotizacion_ref}`, valor: 0, id_mensaje } });
        return this.acuse(await this.cargar(codigo));
      }

      const venta = await this.ventas.crearDesdeFacturacion({
        cotizacion_ref: c.cotizacion_ref, traza_id: c.traza_id, orden_id: codigo,
        pagador: { tipo: 'cliente', documento: c.cliente.cedula, nombre: c.cliente.nombre, retenedor: FACTURACION.clienteRetenedor, autorizacion: null },
        lineas: lineasVenta,
      });
      await this.cots.update({ cotizacion_ref: c.cotizacion_ref }, { venta_id: venta.venta_id });
      // Solo pasa a en_cobro si el pago no llegó antes de terminar este método.
      await this.cots.update({ cotizacion_ref: c.cotizacion_ref, estado: 'aceptada' }, { estado: venta.estado === 'en_revision' ? 'en_revision' : 'en_cobro' });
      if (venta.url_pago) {
        await this.avisar(c, `Hola ${c.cliente.nombre}, su vehículo ${c.vehiculo.placa} está listo. Total a pagar: ${dinero(venta.total_a_pagar)}. Pague por PSE aquí: ${venta.url_pago}`);
      }
      return this.acuse(await this.cargar(codigo));
    });
  }

  // ----------------------------------------------------- 4. cambios de la venta ----

  private async alCambiarVenta(venta: VentaEntity, evento: string): Promise<void> {
    if (!venta.cotizacion_ref) return;
    const c = await this.cots.findOne({ where: { cotizacion_ref: venta.cotizacion_ref } });
    if (!c) return;
    await this.serializar(c.codigo, async () => {
      if (evento === 'pagada') {
        await this.cots.update({ cotizacion_ref: c.cotizacion_ref }, { estado: 'pagada', pago_ref: venta.cobro_id ?? venta.venta_id });
        const id_mensaje = `fac-${c.cotizacion_ref}-pago`;
        await this.salida.encolarParaTaller({ id_mensaje, tipo: 'registrar_pago', traza_id: c.traza_id, codigo: c.codigo, payload: { codigo: c.codigo, referencia_pse: venta.cobro_id ?? venta.venta_id, valor: venta.total_a_pagar, id_mensaje } });
      } else if (evento === 'liquidada') {
        await this.cots.update({ cotizacion_ref: c.cotizacion_ref }, { estado: 'liquidada' });
      } else if (evento === 'pago_rechazado') {
        // Escenario E3: nuevo enlace de pago y aviso al cliente.
        const nueva = await this.ventas.generarCobro({ traza_id: venta.traza_id, venta_id: venta.venta_id });
        if (nueva.url_pago) await this.avisar(c, `Su pago de ${c.cotizacion_ref} fue rechazado. Puede intentarlo de nuevo aquí: ${nueva.url_pago}`);
      } else if (evento === 'reembolsada' || evento === 'en_revision') {
        await this.cots.update({ cotizacion_ref: c.cotizacion_ref }, { estado: 'en_revision', motivo: venta.motivo ?? evento });
      }
    });
  }

  // ------------------------------------------------------------- consultas ----

  async ver(codigoEntrada: string) {
    const c = await this.cargar(this.normalizar(codigoEntrada));
    const venta = c.venta_id ? (await this.db.query(`SELECT url_pago FROM ventas WHERE venta_id = $1`, [c.venta_id]))[0] : null;
    return {
      codigo: c.codigo, cotizacion_ref: c.cotizacion_ref, traza_id: c.traza_id, estado: c.estado as never,
      lineas: c.lineas.map((l) => ({
        tipo: l.tipo as 'mano_obra' | 'repuesto', referencia: l.referencia, descripcion: l.descripcion, cantidad: l.cantidad,
        precio_unitario: l.precio_unitario, iva_porcentaje: Number(l.iva_porcentaje), pagador: l.pagador as never, tienda: l.tienda, estado: l.estado,
      })),
      subtotal: c.subtotal, iva: c.iva, total: c.total, total_cliente: c.total_cliente, total_cubierto_garantia: c.total_cubierto_garantia,
      vence_en: c.vence_en ? c.vence_en.toISOString() : null, venta_id: c.venta_id, pago_ref: c.pago_ref, url_pago: venta?.url_pago ?? null, motivo: c.motivo,
    };
  }

  // Nuevo enlace de pago a petición (el cliente perdió el anterior). Solo si el pago fue rechazado.
  async nuevoCobro(codigoEntrada: string) {
    const c = await this.cargar(this.normalizar(codigoEntrada));
    if (!c.venta_id) throw new ErrorNegocio('ESTADO_INVALIDO', `La orden ${c.codigo} todavía no tiene un cobro`);
    const v = await this.ventas.generarCobro({ traza_id: c.traza_id, venta_id: c.venta_id });
    if (v.url_pago) await this.avisar(c, `Aquí está su nuevo enlace de pago para ${c.cotizacion_ref}: ${v.url_pago}`);
    return this.ver(c.codigo);
  }

  // Cancelación de la orden desde el Taller o por una persona: solo antes de que empiece el cobro.
  async cancelar(codigoEntrada: string, motivo: string) {
    const codigo = this.normalizar(codigoEntrada);
    return this.serializar(codigo, async () => {
      const c = await this.cargar(codigo);
      if (c.estado === 'cancelada') return this.acuse(c);
      if (!['recibida', 'cotizada', 'sin_precio', 'aceptada'].includes(c.estado)) throw new ErrorNegocio('ESTADO_INVALIDO', `No se puede cancelar una cotización ${c.estado}`);
      for (const l of c.lineas.filter((x) => x.compra_ref && x.estado === 'comprada')) {
        await this.precios.liberar(c.traza_id, l.compra_ref!, `Cancelación de ${c.cotizacion_ref}: ${motivo}`).catch(() => {});
        await this.lins.update({ id: l.id }, { estado: 'liberada' });
      }
      await this.cots.update({ cotizacion_ref: c.cotizacion_ref }, { estado: 'cancelada', motivo });
      return this.acuse(await this.cargar(codigo));
    });
  }
}
