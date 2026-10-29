import { dataSource } from './datasource.js';

// npm run migration:revert
await dataSource.initialize();
await dataSource.undoLastMigration();
console.log('Última migración revertida.');
await dataSource.destroy();
