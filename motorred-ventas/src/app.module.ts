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
import { DashboardController } from './dashboard/dashboard.controller.js';
import { PanelController } from './panel/panel.controller.js';
import { SaludController } from './salud.controller.js';
import { ClienteTallerReal } from './facturacion/cliente-taller.js';
import { FacturacionSandboxController } from './facturacion/facturacion-sandbox.controller.js';
import { FacturacionService } from './facturacion/facturacion.service.js';
import { McpFacturacionController } from './facturacion/mcp-facturacion.controller.js';
import { PseSimuladoService } from './facturacion/pse-simulado.service.js';
import { TelegramSimuladoService } from './facturacion/telegram-simulado.service.js';
import { TiendaBuscadorService } from './facturacion/tienda-buscador.service.js';

@Module({
  imports: [
    JwtModule.register({ secret: SECRETO_JWT }),
    TypeOrmModule.forRoot(opcionesDB),
    TypeOrmModule.forFeature([VentaEntity]),
  ],
  controllers: [
    SaludController, OauthController, McpController, BitacoraController, WebhookPasarelaController, AgentesController,
    McpFacturacionController, FacturacionSandboxController, PanelController, DashboardController,
  ],
  providers: [
    HerramientasService, BitacoraService, DineroService, ParametrosService, ProveedoresService, VentasService,
    RagService, AgenteRiesgoService, AgenteCobroService, AgenteConciliacionService, AgenteContableService,
    FacturacionService, TiendaBuscadorService, TelegramSimuladoService, PseSimuladoService, ClienteTallerReal,
  ],
})
export class AppModule {}
