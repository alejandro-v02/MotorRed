import { DataSource } from 'typeorm';
import { FACTURACION } from '../config.js';
import { NotificadorBandeja } from './adaptadores/notificador.bandeja.js';
import { NotificadorTelegram } from './adaptadores/notificador.telegram.js';
import { TallerMcp } from './adaptadores/taller.mcp.js';
import { TiendaReal } from './adaptadores/tienda.real.js';
import { TiendaSimulada } from './adaptadores/tienda.simulada.js';
import { PUERTO_NOTIFICACIONES, PUERTO_PRECIOS, PUERTO_TALLER } from './puertos.js';

// Elige qué adaptador usa cada puerto según .env. Para pasar de simulado a real se cambia la
// variable (TIENDA_MODO, NOTIFICADOR_MODO, TALLER_FACT_URL), no la lógica de Facturación.
export const proveedoresFacturacion = [
  {
    provide: PUERTO_PRECIOS,
    useFactory: () => (FACTURACION.tiendaModo === 'real' ? new TiendaReal() : new TiendaSimulada()),
  },
  {
    provide: PUERTO_TALLER,
    useFactory: () => new TallerMcp(),
  },
  {
    provide: PUERTO_NOTIFICACIONES,
    inject: [DataSource],
    useFactory: (db: DataSource) => (FACTURACION.notificadorModo === 'telegram' ? new NotificadorTelegram() : new NotificadorBandeja(db)),
  },
];
