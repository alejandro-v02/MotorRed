import { Body, Controller, Get, Headers, HttpCode, HttpException, Inject, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { FACTURACION } from '../config.js';
import { ErrorNegocio } from '../negocio/errores.js';
import { CotizacionesService } from './cotizaciones.service.js';
import { PUERTO_PRECIOS, type PuertoPrecios } from './puertos.js';
import { SalidaService } from './salida.service.js';
import { TiendaSimulada } from './adaptadores/tienda.simulada.js';

// Rutas INTERNAS de Facturación (no son herramientas del contrato MCP). Mueven dinero o muestran
// datos personales, así que exigen la llave de operador en X-Llave-Interna (FACT_LLAVE_INTERNA).
//   - /respuesta: único punto de entrada de la decisión del cliente (bot de Telegram, app, operador).
//   - /notificaciones y /mensajes: lo que Facturación le envió al cliente y al Taller.
//   - /sandbox/*: solo laboratorio, con la tienda simulada.
@Controller('internos')
export class FacturacionController {
  constructor(
    private readonly cotizaciones: CotizacionesService,
    private readonly salida: SalidaService,
    @Inject(PUERTO_PRECIOS) private readonly precios: PuertoPrecios,
  ) {}

  private autorizar(llave: string | undefined): void {
    const esperada = Buffer.from(FACTURACION.llaveInterna);
    const recibida = Buffer.from(llave ?? '');
    if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) {
      throw new HttpException({ error: 'Se requiere la cabecera X-Llave-Interna' }, 401);
    }
  }

  private async responder<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ErrorNegocio) {
        const status = { NO_ENCONTRADO: 404, ESTADO_INVALIDO: 409, IDEMPOTENCIA_CONFLICTO: 409, DATOS_INVALIDOS: 400 }[e.codigo] ?? 422;
        throw new HttpException({ error: { codigo: e.codigo, mensaje: e.message, reintentable: e.reintentable } }, status);
      }
      throw e;
    }
  }

  @Get('cotizaciones/:codigo')
  ver(@Headers('x-llave-interna') llave: string | undefined, @Param('codigo') codigo: string) {
    this.autorizar(llave);
    return this.responder(() => this.cotizaciones.ver(codigo));
  }

  @Post('cotizaciones/:codigo/respuesta')
  @HttpCode(200)
  respuesta(@Headers('x-llave-interna') llave: string | undefined, @Param('codigo') codigo: string, @Body() cuerpo: { aceptada?: unknown; motivo?: string }) {
    this.autorizar(llave);
    if (typeof cuerpo?.aceptada !== 'boolean') throw new HttpException({ error: { codigo: 'DATOS_INVALIDOS', mensaje: 'aceptada debe ser true o false' } }, 400);
    return this.responder(() => this.cotizaciones.responderCliente(codigo, { aceptada: cuerpo.aceptada as boolean, motivo: cuerpo.motivo }));
  }

  @Post('cotizaciones/:codigo/nuevo-cobro')
  @HttpCode(200)
  nuevoCobro(@Headers('x-llave-interna') llave: string | undefined, @Param('codigo') codigo: string) {
    this.autorizar(llave);
    return this.responder(() => this.cotizaciones.nuevoCobro(codigo));
  }

  @Post('cotizaciones/:codigo/cancelar')
  @HttpCode(200)
  cancelar(@Headers('x-llave-interna') llave: string | undefined, @Param('codigo') codigo: string, @Body() cuerpo: { motivo?: string }) {
    this.autorizar(llave);
    return this.responder(() => this.cotizaciones.cancelar(codigo, cuerpo?.motivo ?? 'Cancelada por un operador'));
  }

  @Post('cotizaciones/vencer')
  @HttpCode(200)
  async vencer(@Headers('x-llave-interna') llave: string | undefined) {
    this.autorizar(llave);
    return { vencidas: await this.cotizaciones.vencerExpiradas() };
  }

  @Get('notificaciones')
  notificaciones(@Headers('x-llave-interna') llave: string | undefined, @Query('codigo') codigo?: string) {
    this.autorizar(llave);
    return this.salida.listar({ destino: 'cliente', codigo: codigo?.toUpperCase() });
  }

  @Get('mensajes')
  mensajes(@Headers('x-llave-interna') llave: string | undefined, @Query('estado') estado?: string, @Query('codigo') codigo?: string) {
    this.autorizar(llave);
    return this.salida.listar({ destino: 'taller', estado, codigo: codigo?.toUpperCase() });
  }

  @Post('mensajes/:id/reintentar')
  @HttpCode(200)
  async reintentar(@Headers('x-llave-interna') llave: string | undefined, @Param('id', ParseIntPipe) id: number) {
    this.autorizar(llave);
    return { reintentado: await this.salida.reintentar(id) };
  }

  // Sumidero de los eventos de venta (venta.pagada, venta.liquidada...) de las ventas que nacen de una
  // cotización: el Taller real no expone POST /eventos, así que no hay a quién entregárselos. Facturación
  // ya reacciona a estos cambios por dentro (VentasService.alCambiar).
  @Post('eventos-venta')
  @HttpCode(200)
  eventosVenta() {
    return { recibido: true };
  }

  // ---- solo laboratorio (tienda simulada) ----
  @Post('sandbox/reabastecer')
  @HttpCode(200)
  reabastecer(@Headers('x-llave-interna') llave: string | undefined) {
    this.autorizar(llave);
    if (!(this.precios instanceof TiendaSimulada)) throw new HttpException({ error: 'Solo con TIENDA_MODO=simulado' }, 403);
    this.precios.reabastecer();
    return { reabastecida: true };
  }

  @Post('sandbox/cambiar-precio')
  @HttpCode(200)
  cambiarPrecio(@Headers('x-llave-interna') llave: string | undefined, @Body() cuerpo: { codigo?: string; tienda?: string; precio?: number }) {
    this.autorizar(llave);
    if (!(this.precios instanceof TiendaSimulada)) throw new HttpException({ error: 'Solo con TIENDA_MODO=simulado' }, 403);
    if (!cuerpo?.codigo || !cuerpo.tienda || !Number.isInteger(cuerpo.precio)) throw new HttpException({ error: 'Se requiere codigo, tienda y precio entero' }, 400);
    this.precios.cambiarPrecio(cuerpo.codigo, cuerpo.tienda, cuerpo.precio as number);
    return { cambiado: true };
  }
}
