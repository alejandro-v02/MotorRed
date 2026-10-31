import { Injectable, Logger } from '@nestjs/common';
import { N8N } from '../config.js';
import { redactar, registrarSaliente, registroPanel } from '../panel/registro.js';

export interface AvisoCotizacion {
  cotizacion_ref: string;
  codigo: string;
  cliente: { nombre: string; telefono: string };
  mensaje: string;
  total_a_pagar: number;
}
export interface AvisoPago {
  cotizacion_ref: string;
  codigo: string;
  cliente: { nombre: string; telefono: string };
  mensaje: string;
  referencia_pse: string;
  valor: number;
  url_pago: string;
}

// Si N8N_WEBHOOK_COTIZACION / N8N_WEBHOOK_PAGO están configurados, le avisa a n8n (que manda el
// Telegram de verdad y, cuando el cliente responde, nos llama de vuelta a
// POST /facturacion/sandbox/telegram/:cotizacion_ref/responder y
// POST /facturacion/sandbox/pse/:referencia_pse/confirmar). Sin configurar, solo deja el registro
// de siempre — nada se rompe. Ver docs/contratos-reales/automatizacion-n8n.md.
@Injectable()
export class TelegramSimuladoService {
  private readonly logger = new Logger(TelegramSimuladoService.name);

  private async avisarN8n(url: string, payload: unknown, etiqueta: string): Promise<void> {
    if (!url) return;
    try {
      const r = await registrarSaliente(
        { canal: 'n8n', resumen: `Aviso a n8n (${etiqueta})`, metodo: 'POST', ruta: url, peticion: payload },
        () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) }),
        (resp) => ({ estado: resp.status, ok: resp.ok }),
      );
      if (!r.ok) this.logger.warn(`n8n (${etiqueta}) respondió ${r.status}`);
    } catch (e) {
      this.logger.warn(`No se pudo avisar a n8n (${etiqueta}): ${(e as Error).message}`);
    }
  }

  async enviarCotizacion(aviso: AvisoCotizacion): Promise<void> {
    this.logger.log(`SIMULADO Telegram → ${aviso.cliente.telefono}: ${aviso.mensaje}`);
    registroPanel.agregar({ direccion: 'saliente', canal: 'telegram', resumen: `Cotización → ${aviso.cliente.nombre} (${aviso.cliente.telefono})`, ok: true, peticion: redactar(aviso) });
    await this.avisarN8n(N8N.webhookCotizacion, { evento: 'cotizacion_creada', ...aviso }, 'cotización');
  }

  async enviarPse(aviso: AvisoPago): Promise<void> {
    this.logger.log(`SIMULADO Telegram (PSE) → ${aviso.cliente.telefono}: ${aviso.mensaje}`);
    registroPanel.agregar({ direccion: 'saliente', canal: 'telegram', resumen: `Cobro PSE → ${aviso.cliente.nombre} (${aviso.cliente.telefono})`, ok: true, peticion: redactar(aviso) });
    await this.avisarN8n(N8N.webhookPago, { evento: 'pago_pendiente', ...aviso }, 'pago');
  }
}
