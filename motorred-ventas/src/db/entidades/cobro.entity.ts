import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn, type Relation } from 'typeorm';
import { VentaEntity } from './venta.entity.js';

// Un registro por cada cobro que ventas pidió a la pasarela. generar_cobro crea uno nuevo
// cuando el anterior fue rechazado, así que una venta puede tener varios.
@Entity({ name: 'cobros' })
export class CobroEntity {
  @PrimaryColumn({ type: 'varchar' })
  cobro_id!: string;

  @ManyToOne(() => VentaEntity, (v) => v.cobros, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'venta_id' })
  venta!: Relation<VentaEntity>;

  @Column({ type: 'varchar' })
  venta_id!: string;

  @Column({ type: 'integer' })
  monto!: number;

  @Column({ type: 'varchar', default: 'pendiente' })
  estado!: string;

  @Column({ type: 'varchar' })
  url_pago!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  creado_en!: Date;
}
