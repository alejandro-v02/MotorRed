import { Injectable, Logger } from '@nestjs/common';

// SIMULADO: no hay bot de Telegram configurado todavía (ver ADR 0003). Esto solo deja un
// registro de lo que se "enviaría" al cliente. La respuesta real del cliente se simula con
// POST /facturacion/sandbox/telegram/:cotizacion_ref/responder (ver facturacion.controller.ts).
@Injectable()
export class TelegramSimuladoService {
  private readonly logger = new Logger(TelegramSimuladoService.name);

  async enviarCotizacion(telefono: string, mensaje: string): Promise<void> {
    this.logger.log(`SIMULADO Telegram → ${telefono}: ${mensaje}`);
  }

  async enviarPse(telefono: string, mensaje: string): Promise<void> {
    this.logger.log(`SIMULADO Telegram (PSE) → ${telefono}: ${mensaje}`);
  }
}
