import { Controller, Get, HttpException, Param, Post, Query } from '@nestjs/common';
import { AgenteCobroService } from './agente-cobro.service.js';
import { AgenteConciliacionService } from './agente-conciliacion.service.js';
import { AgenteContableService } from './agente-contable.service.js';

// Utilidades INTERNAS (no son herramientas del contrato MCP: ningún otro grupo las llama). Las usa
// el equipo de Ventas para operar: ver qué ventas necesitan un recordatorio, conciliar el día y
// explicar una liquidación. En una puesta en producción real llevarían su propia autenticación de
// operador; aquí se dejan abiertas porque el servicio corre solo en la red del laboratorio.
@Controller('internos')
export class AgentesController {
  constructor(
    private readonly cobro: AgenteCobroService,
    private readonly conciliacion: AgenteConciliacionService,
    private readonly contable: AgenteContableService,
  ) {}

  @Get('cobro/pendientes')
  pendientes(@Query('minutos') minutos?: string) {
    return this.cobro.pendientesDeRecordatorio(minutos ? Number(minutos) : undefined);
  }

  @Post('cobro/:venta_id/recordatorio')
  async recordatorio(@Param('venta_id') venta_id: string) {
    try {
      return await this.cobro.redactarRecordatorio(venta_id);
    } catch (e) {
      throw new HttpException({ error: (e as Error).message }, 400);
    }
  }

  @Get('conciliacion')
  conciliar(@Query('dias') dias?: string) {
    return this.conciliacion.reporte(dias ? Number(dias) : undefined);
  }

  @Get('cierre-contable')
  cierre(@Query('fecha') fecha?: string) {
    return this.contable.cierreDelDia(fecha);
  }

  @Get('liquidacion/:venta_id/explicacion')
  async explicacion(@Param('venta_id') venta_id: string) {
    try {
      return await this.contable.explicarLiquidacion(venta_id);
    } catch (e) {
      throw new HttpException({ error: (e as Error).message }, 404);
    }
  }
}
