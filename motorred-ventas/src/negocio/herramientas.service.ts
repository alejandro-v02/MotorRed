import { Injectable } from '@nestjs/common';
import { GRUPO } from '../config.js';
import { ErrorNegocio } from './errores.js';
import type { CrearVentaInput } from './ventas.service.js';
import { VentasService } from './ventas.service.js';

export interface Contexto {
  cliente: string; // client_id de quien llama (taller, app, auditor)
  alcances: string[]; // alcances del token
}

// Un caso por cada herramienta de ventas (grupo Zaidy). Las reglas de negocio viven en
// VentasService (NestJS + PostgreSQL); aquí solo se enruta. El controlador MCP valida entradas y salidas.
@Injectable()
export class HerramientasService {
  constructor(private readonly ventas: VentasService) {}

  async ejecutar(nombre: string, args: Record<string, unknown>, ctx: Contexto): Promise<unknown> {
    switch (nombre) {
      case 'crear_venta':
        return this.ventas.crearVenta(args as unknown as CrearVentaInput, ctx.cliente);
      case 'consultar_venta':
        return this.ventas.consultarVenta(args as { traza_id: string; venta_id: string });
      case 'generar_cobro':
        return this.ventas.generarCobro(args as { traza_id: string; venta_id: string });
      case 'anular_venta':
        return this.ventas.anularVenta(args as { traza_id: string; venta_id: string; motivo: string });
      case 'consultar_liquidacion':
        return this.ventas.consultarLiquidacion(args as { traza_id: string; venta_id: string });
      default:
        throw new ErrorNegocio('INTERNO', `${GRUPO}: falta implementar ${nombre} (cliente ${ctx.cliente})`);
    }
  }
}
