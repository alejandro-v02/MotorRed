import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import type { ManoObraLineaT, RepuestoLineaT } from '../../facturacion/esquemas.js';

export interface ClienteTaller {
  cedula: string;
  nombre: string;
  telefono: string;
}
export interface VehiculoTaller {
  vin: string;
  placa: string;
  descripcion: string;
}
export interface OrdenCompraLineaGuardada {
  codigo_repuesto: string;
  descripcion: string;
  cantidad: number;
  tienda: string;
  precio_unitario: number;
  pagador: 'cliente' | 'fabricante' | 'tienda' | 'taller';
}

// Cotización hacia el taller REAL (contrato propio, ver docs/contratos-reales/mcp-taller.md).
// No es lo mismo que una VentaEntity: la cotización existe antes de que el cliente acepte; una
// vez acepta, se crea una VentaEntity interna para reutilizar la liquidación/dispersión ya hecha.
@Entity({ name: 'cotizaciones' })
export class CotizacionEntity {
  @PrimaryColumn({ type: 'varchar' })
  cotizacion_ref!: string;

  @Column({ type: 'varchar' })
  codigo!: string;

  @Column({ type: 'varchar' })
  id_relacion!: string;

  @Column({ type: 'varchar' })
  taller!: string;

  @Column({ type: 'varchar' })
  sede!: string;

  @Column({ type: 'jsonb' })
  cliente!: ClienteTaller;

  @Column({ type: 'jsonb' })
  vehiculo!: VehiculoTaller;

  @Column({ type: 'jsonb' })
  mano_obra!: ManoObraLineaT[];

  @Column({ type: 'jsonb' })
  repuestos!: RepuestoLineaT[];

  @Column({ type: 'jsonb', nullable: true })
  orden_compra!: OrdenCompraLineaGuardada[] | null;

  @Column({ type: 'integer' })
  total_mano_obra!: number;

  @Column({ type: 'integer' })
  total_mano_obra_cliente!: number;

  @Column({ type: 'integer', default: 0 })
  total_repuestos_cliente!: number;

  @Column({ type: 'boolean' })
  hay_repuestos!: boolean;

  @Column({ type: 'text' })
  mensaje_garantia!: string;

  // pendiente_respuesta | aceptada | rechazada
  @Column({ type: 'varchar', default: 'pendiente_respuesta' })
  estado!: string;

  @Column({ type: 'varchar', nullable: true })
  motivo_rechazo!: string | null;

  // FK lógica (no @ManyToOne a propósito: VentaEntity es nuestra contabilidad interna, esta
  // entidad es la cara hacia el taller; se consultan por separado).
  @Column({ type: 'varchar', nullable: true })
  venta_id!: string | null;

  @Column({ type: 'varchar' })
  id_mensaje_entrada!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  creada_en!: Date;
}
