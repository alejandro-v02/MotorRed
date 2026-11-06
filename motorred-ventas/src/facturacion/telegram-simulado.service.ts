import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { MENSAJES, N8N } from '../config.js';
import { ClienteConcesionario } from './cliente-concesionario.js';
import { redactar, registrarSaliente, registroPanel } from '../panel/registro.js';

export interface AvisoCotizacion {
  id_relacion: string;
  cotizacion_ref: string;
  codigo: string;
  cliente: { nombre: string; telefono: string };
  mensaje: string;
  total_a_pagar: number;
}
export interface AvisoPago {
  id_relacion: string;
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

  constructor(private readonly concesionario: ClienteConcesionario) {}

  // Si AutoMax está configurado, él le escribe al cliente por su bot. Si no responde o no puede
  // (sin_telegram, telegram_apagado…), NO se rompe el negocio: queda en el log/n8n para seguimiento.
  private async porConcesionario(etiqueta: string, args: Parameters<ClienteConcesionario['notificarCliente']>[0]): Promise<void> {
    if (!this.concesionario.configurado) return;
    try {
      const r = await this.concesionario.notificarCliente(args);
      if (r.enviado) this.logger.log(`AutoMax envió el aviso de ${etiqueta} (${args.codigo}) por ${r.canal ?? 'telegram'}`);
      else this.logger.warn(`AutoMax NO envió el aviso de ${etiqueta} (${args.codigo}): ${r.motivo} - ${r.detalle ?? ''}. Avisar al cliente por otro canal.`);
    } catch (e) {
      this.logger.warn(`No se pudo avisar por AutoMax (${etiqueta} ${args.codigo}): ${(e as Error).message}`);
    }
  }

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
    registroPanel.agregar({ direccion: 'saliente', canal: 'telegram', resumen: `${this.concesionario.configurado ? 'Respaldo local (el envío real va por AutoMax) · ' : 'SIMULADO · '}Cotización → ${aviso.cliente.nombre} (${aviso.cliente.telefono})`, ok: true, peticion: redactar(aviso) });
    await this.porConcesionario('cotización', {
      id_relacion: aviso.id_relacion, codigo: aviso.codigo, tipo: 'cotizacion', cotizacion_ref: aviso.cotizacion_ref,
      // Con MENSAJE_NEGRITA=html el texto trae los precios en <b>…</b> (y el resto escapado).
      texto: aviso.mensaje, ...(MENSAJES.negrita ? { formato: 'html' as const } : {}), id_mensaje: `fac-${aviso.cotizacion_ref}-aviso-cotizacion`,
    });
    await this.avisarN8n(N8N.webhookCotizacion, { evento: 'cotizacion_creada', ...aviso }, 'cotización');
  }

  async enviarPse(aviso: AvisoPago): Promise<void> {
    this.logger.log(`SIMULADO Telegram (PSE) → ${aviso.cliente.telefono}: ${aviso.mensaje}`);
    registroPanel.agregar({ direccion: 'saliente', canal: 'telegram', resumen: `${this.concesionario.configurado ? 'Respaldo local (el envío real va por AutoMax) · ' : 'SIMULADO · '}Cobro PSE → ${aviso.cliente.nombre} (${aviso.cliente.telefono})`, ok: true, peticion: redactar(aviso) });
    await this.porConcesionario('pago', {
      id_relacion: aviso.id_relacion, codigo: aviso.codigo, tipo: 'pago', cotizacion_ref: aviso.cotizacion_ref,
      texto: aviso.mensaje, enlace_pago: aviso.url_pago, id_mensaje: `fac-${aviso.cotizacion_ref}-aviso-pago-${aviso.referencia_pse}-${createHash('sha1').update(aviso.url_pago).digest('hex').slice(0, 8)}`,
    });
    await this.avisarN8n(N8N.webhookPago, { evento: 'pago_pendiente', ...aviso }, 'pago');
  }
}
