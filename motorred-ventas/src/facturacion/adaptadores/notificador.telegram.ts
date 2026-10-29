import { ErrorNegocio } from '../../negocio/errores.js';
import type { PuertoNotificaciones } from '../puertos.js';

// PENDIENTE: decidir si se usa un bot de Telegram real (NOTIFICADOR_MODO=telegram) o se queda la
// bandeja simulada. El Excel del Taller dice que Facturación "le avisa al cliente por Telegram" y
// que recibe su respuesta ahí, pero no define el bot. Para completarlo:
//   1. Crear el bot (BotFather) y guardar TELEGRAM_BOT_TOKEN en .env (nunca en el repositorio).
//   2. Resolver teléfono → chat_id (el cliente debe haber escrito antes al bot).
//   3. Enviar el texto con POST https://api.telegram.org/bot<token>/sendMessage.
//   4. Recibir la respuesta del cliente (webhook del bot) y llamar a
//      POST /internos/cotizaciones/:codigo/respuesta, que ya existe: ese es el único punto de
//      entrada de la decisión del cliente, así que el bot no necesita tocar nada más.
export class NotificadorTelegram implements PuertoNotificaciones {
  async avisarCliente(_aviso: { traza_id: string; codigo: string; telefono: string; nombre: string; texto: string }): Promise<boolean> {
    throw new ErrorNegocio('INTERNO', 'Notificador de Telegram pendiente: ver src/facturacion/adaptadores/notificador.telegram.ts');
  }
}
