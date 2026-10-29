import { dataSource } from './datasource.js';

// npm run migration:run
await dataSource.initialize();
const ejecutadas = await dataSource.runMigrations();
console.log(ejecutadas.length ? `Migraciones aplicadas: ${ejecutadas.map((m) => m.name).join(', ')}` : 'Nada por migrar.');
await dataSource.destroy();
