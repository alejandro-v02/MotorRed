import type { DataSource } from 'typeorm';
import type { PuertoNotificaciones } from '../puertos.js';

// Notificador simulado: en vez de escribirle al cliente por Telegram, deja el mensaje en la tabla
// mensajes_salida (destino 'cliente', ya "enviado") para que las pruebas y la sustentación lo lean
// con GET /internos/notificaciones. Es lo que hace el Taller cuando no tiene URL de destino.
export class NotificadorBandeja implements PuertoNotificaciones {
  constructor(private readonly db: DataSource) {}

  async avisarCliente(a: { traza_id: string; codigo: string; telefono: string; nombre: string; texto: string }): Promise<boolean> {
    await this.db.query(
      `INSERT INTO mensajes_salida (id_mensaje, destino, tipo, traza_id, codigo, payload, estado, intentos, enviado_en)
       VALUES ($1,'cliente','aviso_cliente',$2,$3,$4,'enviado',1,now()) ON CONFLICT (id_mensaje) DO NOTHING`,
      [`cli-${a.codigo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, a.traza_id, a.codigo, JSON.stringify({ telefono: a.telefono, nombre: a.nombre, texto: a.texto })],
    );
    return true;
  }
}
