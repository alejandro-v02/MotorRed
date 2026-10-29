import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation } from 'typeorm';
import { CotizacionEntity } from './cotizacion.entity.js';

// tipo: mano_obra | repuesto. pagador: cliente | fabricante | tienda | taller.
// estado: pendiente_precio, cotizada, sin_stock, sin_precio, comprada, liberada, realizada, no_realizada.
@Entity({ name: 'lineas_cotizacion' })
export class LineaCotizacionEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => CotizacionEntity, (c) => c.lineas, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cotizacion_ref' })
  cotizacion!: Relation<CotizacionEntity>;

  @Column({ type: 'varchar' })
  cotizacion_ref!: string;

  @Column({ type: 'integer' })
  tarea_id!: number;

  @Column({ type: 'varchar' })
  tipo!: string;

  // sku del servicio o código universal del repuesto
  @Column({ type: 'varchar' })
  referencia!: string;

  @Column({ type: 'varchar' })
  descripcion!: string;

  @Column({ type: 'integer' })
  cantidad!: number;

  @Column({ type: 'integer', nullable: true })
  precio_unitario!: number | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  iva_porcentaje!: number;

  @Column({ type: 'varchar', default: 'cliente' })
  pagador!: string;

  @Column({ type: 'jsonb', nullable: true })
  garantia!: Record<string, unknown> | null;

  // Quién vendió el repuesto: define el beneficiario de la línea en la venta final.
  @Column({ type: 'varchar', nullable: true })
  proveedor!: string | null;

  @Column({ type: 'varchar', nullable: true })
  tienda!: string | null;

  // Identificadores que devuelve el adaptador de la tienda al cotizar y al comprar.
  @Column({ type: 'varchar', nullable: true })
  oferta_ref!: string | null;

  @Column({ type: 'varchar', nullable: true })
  compra_ref!: string | null;

  @Column({ type: 'varchar', default: 'pendiente_precio' })
  estado!: string;
}
