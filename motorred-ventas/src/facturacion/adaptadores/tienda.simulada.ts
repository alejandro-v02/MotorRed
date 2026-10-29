import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ } from '../../config.js';
import { ErrorNegocio } from '../../negocio/errores.js';
import type { CompraRepuesto, OfertaRepuesto, PuertoPrecios } from '../puertos.js';

interface FilaCatalogo {
  tienda: string;
  proveedor: 'tienda' | 'concesionario';
  precio_unitario: number;
  stock: number;
}

// Tienda simulada: precios y existencias salen de datos/precios-simulados.json y el inventario vive
// en memoria. Cumple el puerto igual que lo hará el adaptador real, así que toda la lógica de
// cotización y compra se puede probar hoy. Se reemplaza con TIENDA_MODO=real.
export class TiendaSimulada implements PuertoPrecios {
  private catalogo: Record<string, FilaCatalogo[]>;
  private readonly original: string;
  private readonly stock = new Map<string, number>(); // codigo|tienda → unidades
  private readonly compras = new Map<string, { compra_ref: string; codigo: string; tienda: string; cantidad: number; precio_unitario: number; activa: boolean }>(); // por clave
  private consecutivo = 0;

  constructor() {
    this.original = readFileSync(join(RAIZ, 'datos', 'precios-simulados.json'), 'utf8');
    this.catalogo = {};
    this.reabastecer();
  }

  async cotizar(_traza_id: string, r: { codigo_repuesto: string; cantidad: number }): Promise<OfertaRepuesto | null> {
    const ofertas = (this.catalogo[r.codigo_repuesto] ?? [])
      .filter((f) => (this.stock.get(`${r.codigo_repuesto}|${f.tienda}`) ?? 0) >= r.cantidad)
      .sort((a, b) => a.precio_unitario - b.precio_unitario);
    const mejor = ofertas[0];
    if (!mejor) return null;
    return {
      oferta_ref: `SIM|${r.codigo_repuesto}|${mejor.tienda}`,
      proveedor: mejor.proveedor,
      tienda: mejor.tienda,
      precio_unitario: mejor.precio_unitario,
      iva_porcentaje: null,
      stock: this.stock.get(`${r.codigo_repuesto}|${mejor.tienda}`) ?? 0,
    };
  }

  async comprar(_traza_id: string, clave: string, oferta: OfertaRepuesto, cantidad: number): Promise<CompraRepuesto> {
    const previa = this.compras.get(clave);
    if (previa) return { compra_ref: previa.compra_ref, precio_unitario: previa.precio_unitario };
    const [, codigo, tienda] = oferta.oferta_ref.split('|');
    const fila = (this.catalogo[codigo] ?? []).find((f) => f.tienda === tienda);
    if (!fila) throw new ErrorNegocio('OFERTA_VENCIDA', `La oferta ${oferta.oferta_ref} ya no existe`);
    const llave = `${codigo}|${tienda}`;
    if ((this.stock.get(llave) ?? 0) < cantidad) throw new ErrorNegocio('STOCK_INSUFICIENTE', `${codigo} en ${tienda}: quedan ${this.stock.get(llave) ?? 0}`);
    this.stock.set(llave, (this.stock.get(llave) ?? 0) - cantidad);
    const compra_ref = `CMP-SIM-${String(++this.consecutivo).padStart(5, '0')}`;
    this.compras.set(clave, { compra_ref, codigo, tienda, cantidad, precio_unitario: fila.precio_unitario, activa: true });
    return { compra_ref, precio_unitario: fila.precio_unitario };
  }

  async liberar(_traza_id: string, compra_ref: string, _motivo: string): Promise<void> {
    for (const c of this.compras.values()) {
      if (c.compra_ref === compra_ref && c.activa) {
        c.activa = false;
        const llave = `${c.codigo}|${c.tienda}`;
        this.stock.set(llave, (this.stock.get(llave) ?? 0) + c.cantidad);
      }
    }
  }

  // Solo laboratorio y pruebas: deja precios e inventario como en el JSON.
  reabastecer(): void {
    const { _nota, ...datos } = JSON.parse(this.original);
    void _nota;
    this.catalogo = datos;
    this.stock.clear();
    for (const [codigo, filas] of Object.entries(this.catalogo)) for (const f of filas) this.stock.set(`${codigo}|${f.tienda}`, f.stock);
    this.compras.clear();
  }

  // Solo pruebas: cambia el precio de una oferta para simular que la tienda lo alteró entre la
  // cotización y la compra.
  cambiarPrecio(codigo: string, tienda: string, precio: number): void {
    const fila = (this.catalogo[codigo] ?? []).find((f) => f.tienda === tienda);
    if (fila) fila.precio_unitario = precio;
  }
}
