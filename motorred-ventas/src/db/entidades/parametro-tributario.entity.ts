import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Tarifas y bases con vigencia: NUNCA se escriben en el código (cambian por decreto, ver
// Concepto 5 del Instructivo 5). Se consulta la fila vigente para "hoy" por concepto.
// concepto: iva_general | comision_plataforma | uvt | retefuente_servicio | retefuente_repuesto
@Entity({ name: 'parametros_tributarios' })
export class ParametroTributarioEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  concepto!: string;

  // Tarifa en porcentaje (IVA, comisión, retefuente). Nula cuando el concepto es un valor absoluto (UVT).
  @Column({ type: 'numeric', precision: 6, scale: 3, nullable: true })
  tarifa!: string | null;

  // Base mínima en UVT a partir de la cual aplica una retención (nula si no aplica).
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  base_uvt!: string | null;

  // Valor absoluto en pesos (por ejemplo, el valor de la UVT del año).
  @Column({ type: 'integer', nullable: true })
  valor!: number | null;

  @Column({ type: 'date' })
  vigente_desde!: string;

  @Column({ type: 'date', nullable: true })
  vigente_hasta!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creado_en!: Date;
}
