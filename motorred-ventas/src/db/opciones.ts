import type { DataSourceOptions } from 'typeorm';
import { DB } from '../config.js';
import {
  AsientoEntity, ClaveIdempotenciaEntity, CobroEntity, CotizacionEntity, DecisionRiesgoEntity, DispersionEntity,
  EventoPasarelaEntity, FragmentoConocimientoEntity, LineaVentaEntity, MensajeProcesadoEntity,
  PagoPseEntity, ParametroTributarioEntity, VentaEntity,
} from './entidades/index.js';
import { Inicial1769644800000 } from './migraciones/0001_inicial.js';
import { Facturacion1769700000000 } from './migraciones/0002_facturacion.js';
import { PagosPseLineas1769700100000 } from './migraciones/0003_pagos_pse_lineas.js';

// Una sola fuente de la configuración de conexión: la usan NestJS (TypeOrmModule.forRoot) y los
// scripts de migración/seed (DataSource aparte, sin el framework). synchronize siempre en false:
// el esquema se gobierna con migraciones (Trabajo 3, Paso 3).
export const opcionesDB: DataSourceOptions = {
  type: 'postgres',
  host: DB.host,
  port: DB.port,
  username: DB.usuario,
  password: DB.clave,
  database: DB.base,
  entities: [
    VentaEntity, LineaVentaEntity, CobroEntity, EventoPasarelaEntity, DispersionEntity,
    AsientoEntity, ParametroTributarioEntity, ClaveIdempotenciaEntity, FragmentoConocimientoEntity, DecisionRiesgoEntity,
    CotizacionEntity, PagoPseEntity, MensajeProcesadoEntity,
  ],
  migrations: [Inicial1769644800000, Facturacion1769700000000, PagosPseLineas1769700100000],
  synchronize: false,
  logging: false,
};
