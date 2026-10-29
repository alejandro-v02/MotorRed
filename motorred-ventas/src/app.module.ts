import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SECRETO_JWT } from './config.js';
import { opcionesDB } from './db/opciones.js';
import { VentaEntity } from './db/entidades/venta.entity.js';
import { AgenteCobroService } from './agentes/agente-cobro.service.js';
import { AgenteConciliacionService } from './agentes/agente-conciliacion.service.js';
import { AgenteContableService } from './agentes/agente-contable.service.js';
import { AgenteRiesgoService } from './agentes/agente-riesgo.service.js';
import { AgentesController } from './agentes/agentes.controller.js';
import { RagService } from './agentes/rag.service.js';
import { BitacoraController, BitacoraService } from './mcp/bitacora.service.js';
import { McpController } from './mcp/mcp.controller.js';
import { OauthController } from './mcp/oauth.controller.js';
import { DineroService } from './negocio/dinero.service.js';
import { HerramientasService } from './negocio/herramientas.service.js';
import { ParametrosService } from './negocio/parametros.service.js';
import { ProveedoresService } from './negocio/proveedores.service.js';
import { VentasService } from './negocio/ventas.service.js';
import { WebhookPasarelaController } from './negocio/webhook-pasarela.controller.js';
import { SaludController } from './salud.controller.js';
import { CotizacionesService } from './facturacion/cotizaciones.service.js';
import { FacturacionController } from './facturacion/facturacion.controller.js';
import { proveedoresFacturacion } from './facturacion/proveedores-facturacion.js';
import { SalidaService } from './facturacion/salida.service.js';

@Module({
  imports: [
    JwtModule.register({ secret: SECRETO_JWT }),
    TypeOrmModule.forRoot(opcionesDB),
    TypeOrmModule.forFeature([VentaEntity]),
  ],
  controllers: [SaludController, OauthController, McpController, BitacoraController, WebhookPasarelaController, AgentesController, FacturacionController],
  providers: [
    HerramientasService, BitacoraService, DineroService, ParametrosService, ProveedoresService, VentasService,
    RagService, AgenteRiesgoService, AgenteCobroService, AgenteConciliacionService, AgenteContableService,
    ...proveedoresFacturacion, SalidaService, CotizacionesService,
  ],
})
export class AppModule {}
