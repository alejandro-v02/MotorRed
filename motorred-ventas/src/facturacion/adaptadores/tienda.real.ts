import { ErrorNegocio } from '../../negocio/errores.js';
import type { CompraRepuesto, OfertaRepuesto, PuertoPrecios } from '../puertos.js';

// PENDIENTE: contrato de la Tienda de repuestos (grupo José) y del Concesionario (grupo Emerson).
// Este archivo es el ÚNICO que hay que completar para dejar de usar la tienda simulada
// (TIENDA_MODO=real en .env). Lo demás de Facturación ya depende solo del puerto PuertoPrecios.
//
// Lo que hay que averiguar con cada grupo y dónde se usa:
//   1. Herramienta para consultar precio y existencia por CÓDIGO UNIVERSAL de repuesto
//      (PAS-DEL-CER...). El contrato 1.0 del kit usa buscar_repuestos por CATEGORÍA + vehículo; si
//      la Tienda real sigue así, hace falta una tabla código_repuesto → categoría y el vehículo de
//      la cotización (ya está en cotizaciones.vehiculo).                          → cotizar()
//   2. Cómo se compra: el kit usa reservar_repuestos + confirmar_reserva (dos pasos, con precio
//      congelado y vencimiento). Confirmar si sigue igual o hay una herramienta de compra.  → comprar()
//   3. Cómo se deshace una compra (liberar_reserva en el kit).                   → liberar()
//   4. Cómo se autentica Facturación ante ellos (OAuth client_credentials como en el kit, o token
//      fijo) y las URL/credenciales: agregar URL_TIENDA_FACT / CLIENTE_VENTAS_EN_TIENDA en .env.
//   5. Si el IVA viene en la oferta (OfertaRepuesto.iva_porcentaje) o lo aplicamos nosotros.
//   6. Qué devuelve cuando hay varias tiendas: aquí se elige la más barata con stock suficiente.
//
// Para llamar al otro servicio use ClienteServicio (mcp/cliente-servicio.ts) como lo hace
// negocio/proveedores.service.ts: const r = await this.tienda.llamar('buscar_repuestos', {...}).
export class TiendaReal implements PuertoPrecios {
  async cotizar(_traza_id: string, _repuesto: { codigo_repuesto: string; cantidad: number }): Promise<OfertaRepuesto | null> {
    throw new ErrorNegocio('INTERNO', 'Adaptador real de la tienda pendiente: ver src/facturacion/adaptadores/tienda.real.ts y docs/pendientes-contratos.md');
  }

  async comprar(_traza_id: string, _clave: string, _oferta: OfertaRepuesto, _cantidad: number): Promise<CompraRepuesto> {
    throw new ErrorNegocio('INTERNO', 'Adaptador real de la tienda pendiente: ver src/facturacion/adaptadores/tienda.real.ts');
  }

  async liberar(_traza_id: string, _compra_ref: string, _motivo: string): Promise<void> {
    throw new ErrorNegocio('INTERNO', 'Adaptador real de la tienda pendiente: ver src/facturacion/adaptadores/tienda.real.ts');
  }
}
