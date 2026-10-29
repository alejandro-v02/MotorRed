# Plantilla del servicio de un grupo (NestJS)

Trae resuelta la "plomería" común del ecosistema:

- `POST /oauth/token`: credenciales de servicio con alcances.
- `/mcp`: servidor MCP que publica solo las herramientas que permiten los alcances del token.
- `GET /salud`.
- `src/mcp/firma.ts`: verificación de la firma de los eventos.
- `src/contrato/`: el contrato en TypeScript.

El trabajo del grupo empieza en `src/negocio/herramientas.service.ts`.

```
npm ci
GRUPO=tienda PUERTO=3000 npm start        (en PowerShell: $env:GRUPO="tienda"; $env:PUERTO="3000"; npm start)
```

Desde la carpeta del kit, con el ecosistema corriendo:

```
node pruebas/conformidad.mjs tienda --url http://localhost:3000
```

Sin implementar nada, ya pasan las secciones `general` y `herramientas`. La sección `reglas` es su trabajo.

Agregue PostgreSQL con TypeORM y migraciones como en el proyecto espiga-pro (Instructivo 4).
