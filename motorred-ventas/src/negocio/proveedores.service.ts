import { Injectable } from '@nestjs/common';
import { credencialSaliente, URLS } from '../config.js';
import { ClienteServicio } from '../mcp/cliente-servicio.js';

export type Proveedor = 'tienda' | 'concesionario';

// Clientes MCP hacia tienda y concesionario, con el alcance proveedor.confirmar: solo ventas
// puede confirmar o liberar una reserva ya consultada (regla del contrato).
@Injectable()
export class ProveedoresService {
  private readonly clientes: Record<Proveedor, ClienteServicio> = {
    tienda: new ClienteServicio({ destino: 'tienda', url: URLS.tienda, clientId: 'ventas', clientSecret: credencialSaliente('tienda'), alcances: ['proveedor.confirmar'] }),
    concesionario: new ClienteServicio({ destino: 'concesionario', url: URLS.concesionario, clientId: 'ventas', clientSecret: credencialSaliente('concesionario'), alcances: ['proveedor.confirmar'] }),
  };

  de(proveedor: Proveedor): ClienteServicio {
    return this.clientes[proveedor];
  }
}
