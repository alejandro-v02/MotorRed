import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation } from 'typeorm';
import { VentaEntity } from './venta.entity.js';

// concepto: servicio | repuesto | garantia. beneficiario: taller | tienda | concesionario.
@Entity({ name: 'lineas_venta' })
export class LineaVentaEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => VentaEntity, (v) => v.lineas, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'venta_id' })
  venta!: Relation<VentaEntity>;

  @Column({ type: 'varchar' })
  venta_id!: string;

  @Column({ type: 'varchar' })
  beneficiario!: string;

  @Column({ type: 'varchar' })
  concepto!: string;

  @Column({ type: 'varchar' })
  referencia!: string;

  @Column({ type: 'varchar' })
  descripcion!: string;

  @Column({ type: 'integer' })
  cantidad!: number;

  @Column({ type: 'integer' })
  precio_unitario!: number;

  @Column({ type: 'numeric', precision: 5, scale: 2 })
  iva_porcentaje!: number;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  reserva_id!: string | null;
}
