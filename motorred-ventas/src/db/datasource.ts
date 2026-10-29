import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { opcionesDB } from './opciones.js';

// DataSource independiente de NestJS, para los scripts de migración y de seed.
export const dataSource = new DataSource(opcionesDB);
