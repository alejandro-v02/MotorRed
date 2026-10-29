import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { LineaVentaEntity } from './linea-venta.entity.js';
import { DispersionEntity } from './dispersion.entity.js';
import { AsientoEntity } from './asiento.entity.js';
import { CobroEntity } from './cobro.entity.js';

export interface Pagador {
  tipo: 'cliente' | 'concesionario';
  documento: string;
  nombre: string;
  retenedor: boolean;
  autorizacion: string | null;
}

// ESTADOS_VENTA del contrato: pendiente_pago, pago_rechazado, pagada, liquidada, reembolsada, anulada, en_revision.
@Entity({ name: 'ventas' })
export class VentaEntity {
  @PrimaryColumn({ type: 'varchar' })
  venta_id!: string;

  @Index()
  @Column({ type: 'uuid' })
  traza_id!: string;

  @Column({ type: 'varchar' })
  orden_id!: string;

  @Column({ type: 'varchar', default: 'pendiente_pago' })
  estado!: string;

  @Column({ type: 'jsonb' })
  pagador!: Pagador;

  @Column({ type: 'integer' })
  subtotal!: number;

  @Column({ type: 'integer' })
  iva!: number;

  @Column({ type: 'integer' })
  retenciones!: number;

  @Column({ type: 'integer' })
  total!: number;

  @Column({ type: 'integer' })
  total_a_pagar!: number;

  @Column({ type: 'varchar', nullable: true })
  url_pago!: string | null;

  @Column({ type: 'varchar' })
  url_notificacion!: string;

  // Interno: cobro vigente en la pasarela. No se publica en la salida del contrato.
  @Column({ type: 'varchar', nullable: true })
  cobro_id!: string | null;

  // Interno: motivo de en_revision o reembolsada.
  @Column({ type: 'varchar', nullable: true })
  motivo!: string | null;

  // true cuando ya se confirmaron todas las reservas y se liquidó (para no repetir la saga).
  @Column({ type: 'boolean', default: false })
  liquidada!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  creada_en!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizada_en!: Date;

  @OneToMany(() => LineaVentaEntity, (l) => l.venta)
  lineas!: LineaVentaEntity[];

  @OneToMany(() => DispersionEntity, (d) => d.venta)
  dispersiones!: DispersionEntity[];

  @OneToMany(() => AsientoEntity, (a) => a.venta)
  asientos!: AsientoEntity[];

  @OneToMany(() => CobroEntity, (c) => c.venta)
  cobros!: CobroEntity[];
}
