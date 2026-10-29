import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { LineaCotizacionEntity } from './linea-cotizacion.entity.js';

// ESTADOS_COTIZACION de contrato/facturacion.ts: recibida, cotizada, aceptada, rechazada, vencida,
// cancelada, sin_precio, en_cobro, pagada, liquidada, en_revision.
@Entity({ name: 'cotizaciones' })
export class CotizacionEntity {
  @PrimaryColumn({ type: 'varchar' })
  cotizacion_ref!: string; // FAC-OT-0054

  @Column({ type: 'varchar', unique: true })
  codigo!: string; // OT-0054, la orden del Taller

  @Index()
  @Column({ type: 'uuid' })
  traza_id!: string; // el Taller real no envía traza_id: la genera Facturación al recibir la orden

  @Column({ type: 'varchar' })
  id_relacion!: string;

  @Column({ type: 'varchar', nullable: true })
  taller!: string | null;

  @Column({ type: 'varchar', nullable: true })
  sede!: string | null;

  @Column({ type: 'jsonb' })
  cliente!: { cedula: string; nombre: string; telefono: string };

  @Column({ type: 'jsonb' })
  vehiculo!: { vin?: string; placa: string; descripcion: string };

  @Index()
  @Column({ type: 'varchar', default: 'recibida' })
  estado!: string;

  @Column({ type: 'varchar', nullable: true })
  mensaje_garantia!: string | null;

  @Column({ type: 'integer', default: 0 })
  subtotal!: number;

  @Column({ type: 'integer', default: 0 })
  iva!: number;

  @Column({ type: 'integer', default: 0 })
  total!: number;

  @Column({ type: 'integer', default: 0 })
  total_cliente!: number;

  @Column({ type: 'integer', default: 0 })
  total_cubierto_garantia!: number;

  @Column({ type: 'timestamptz', nullable: true })
  vence_en!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  motivo!: string | null;

  // Huella del cuerpo recibido: la misma orden con otros datos es IDEMPOTENCIA_CONFLICTO.
  @Column({ type: 'varchar' })
  huella!: string;

  @Column({ type: 'varchar', nullable: true })
  venta_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  pago_ref!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creada_en!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizada_en!: Date;

  @OneToMany(() => LineaCotizacionEntity, (l) => l.cotizacion)
  lineas!: LineaCotizacionEntity[];
}
