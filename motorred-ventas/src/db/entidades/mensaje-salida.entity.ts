import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// Bandeja de salida de Facturación: lo que debe llegar al Taller (registrar_respuesta_cliente,
// registrar_pago) o al cliente (aviso de cotización, enlace de pago). destino: taller | cliente.
@Entity({ name: 'mensajes_salida' })
export class MensajeSalidaEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', unique: true })
  id_mensaje!: string; // el mismo en cada reintento: el destino no repite el efecto

  @Column({ type: 'varchar' })
  destino!: string;

  @Column({ type: 'varchar' })
  tipo!: string;

  @Column({ type: 'uuid', nullable: true })
  traza_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  codigo!: string | null;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Index()
  @Column({ type: 'varchar', default: 'pendiente' })
  estado!: string; // pendiente | enviado | fallido

  @Column({ type: 'integer', default: 0 })
  intentos!: number;

  @Column({ type: 'varchar', nullable: true })
  ultimo_error!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creado_en!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  enviado_en!: Date | null;
}
