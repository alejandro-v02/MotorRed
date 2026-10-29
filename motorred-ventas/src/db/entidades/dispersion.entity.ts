import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation } from 'typeorm';
import { VentaEntity } from './venta.entity.js';

// Cuánto le corresponde a cada beneficiario (taller, tienda o concesionario) de una venta liquidada.
@Entity({ name: 'dispersiones' })
export class DispersionEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => VentaEntity, (v) => v.dispersiones, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'venta_id' })
  venta!: Relation<VentaEntity>;

  @Column({ type: 'varchar' })
  venta_id!: string;

  @Column({ type: 'varchar' })
  beneficiario!: string;

  @Column({ type: 'integer' })
  base!: number;

  @Column({ type: 'integer' })
  iva!: number;

  @Column({ type: 'integer' })
  retencion!: number;

  @Column({ type: 'integer' })
  comision!: number;

  @Column({ type: 'integer' })
  iva_comision!: number;

  @Column({ type: 'integer' })
  neto!: number;

  // pendiente | transferida
  @Column({ type: 'varchar', default: 'pendiente' })
  estado!: string;

  @Column({ type: 'varchar', nullable: true })
  referencia!: string | null;
}
