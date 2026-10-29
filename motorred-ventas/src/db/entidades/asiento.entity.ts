import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation } from 'typeorm';
import { VentaEntity } from './venta.entity.js';

// Partida doble (Decreto 2650 de 1993, PUC - códigos ilustrativos). Los débitos deben sumar
// lo mismo que los créditos en cada venta liquidada: lo comprueba Liquidacion.cuadra.
@Entity({ name: 'asientos' })
export class AsientoEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => VentaEntity, (v) => v.asientos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'venta_id' })
  venta!: Relation<VentaEntity>;

  @Column({ type: 'varchar' })
  venta_id!: string;

  @Column({ type: 'varchar' })
  cuenta!: string;

  @Column({ type: 'varchar' })
  nombre_cuenta!: string;

  @Column({ type: 'varchar' })
  tercero!: string;

  @Column({ type: 'integer' })
  debito!: number;

  @Column({ type: 'integer' })
  credito!: number;
}
