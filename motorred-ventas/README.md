# motorred-ventas — Ventas y contabilidad (grupo Zaidy)

Servicio real del grupo Zaidy en el ecosistema MotorRed (Instructivo 5): el orquestador
comercial. Arma la venta, verifica cada línea contra la reserva real del proveedor, cobra con la
pasarela, confirma las reservas, liquida (IVA, retención, comisión) y dispersa el dinero. Cuando
algo no cuadra, no improvisa: deja la venta `en_revision` para una persona.

Construido sobre la plantilla NestJS del kit (`ecosistema-motor/plantilla-nestjs`), con PostgreSQL
+ pgvector, TypeORM con migraciones, y cuatro agentes de IA con barandas.

**Informe técnico completo (para la entrega del Trabajo 8):** [`docs/informe-tecnico.md`](docs/informe-tecnico.md)
— reúne el modelo de datos, los ADR, las fichas de los agentes, el informe de pruebas y el plan de
respaldo en un solo documento. Para exportarlo a PDF: ábralo en VS Code y use la extensión
"Markdown PDF" (clic derecho → "Markdown PDF: Export (pdf)"), o ábralo con la vista previa de
Markdown y use "Imprimir → Guardar como PDF" desde el navegador.

## Qué trae

- Las 5 herramientas MCP de ventas (`crear_venta`, `consultar_venta`, `generar_cobro`,
  `anular_venta`, `consultar_liquidacion`) implementadas en [`src/negocio/ventas.service.ts`](src/negocio/ventas.service.ts),
  con la saga completa (cobrar → confirmar reservas → liquidar → dispersar, con compensación si algo falla).
- `POST /webhooks/pasarela`, idempotente y con firma verificada.
- Modelo de datos en PostgreSQL ([`docs/modelo-datos.md`](docs/modelo-datos.md)), con migraciones
  (`src/db/migraciones/`) y parámetros tributarios con vigencia.
- RAG con pgvector sobre la política de cobro y conciliación ([`docs/conocimiento/`](docs/conocimiento/)).
- Cuatro agentes ([`docs/agentes.md`](docs/agentes.md)): **Riesgo** (clasifica antes de cobrar, con
  evaluación formal), **Cobro** (recordatorios), **Conciliación** (diferencias) y **Contable**
  (explica liquidaciones y arma el cierre del día).
- Dos ADR ([`docs/adr/`](docs/adr/)) sobre el modelo de datos y sobre qué decide el agente vs. el código.
- `Dockerfile` + `docker-compose.yml` con su propia base de datos.

## Primeros pasos

```bash
npm ci
copy .env.ejemplo .env          # revise GRUPO, las URL_* y las credenciales
```

### Base de datos

```bash
docker run -d --name ventas-db -e POSTGRES_USER=motorred -e POSTGRES_PASSWORD=motorred \
  -e POSTGRES_DB=motorred_ventas -p 5432:5432 pgvector/pgvector:pg16
npm run migration:run
npm run seed                    # parámetros tributarios + indexa docs/conocimiento en el RAG
```

El seed del RAG necesita Ollama corriendo con `ollama pull nomic-embed-text` (ver `.env.ejemplo`).

### Levantar el servicio

```bash
npm start
```

### Probarlo contra el ecosistema de referencia

Con `ecosistema-motor` en otra carpeta y `npm run ecosistema` corriendo ahí (o, para probar solo
este servicio, `node ecosistema.mjs --sin ventas` con `URL_VENTAS=http://localhost:3000` en su
`.env` del kit):

```bash
node pruebas/conformidad.mjs ventas --url http://localhost:3000
node pruebas/escenarios.mjs
```

**Resultado real de estas pruebas contra este servicio** (23 oct–29 oct 2026, Node 24, Docker,
Ollama con `nomic-embed-text` y `llama3.2`; ver el detalle completo en el informe técnico):

```
CONFORMIDAD DE VENTAS: 58 de 58 pruebas correctas
RESUMEN DE ESCENARIOS: 79 de 79 pruebas correctas
```

### Evaluar el agente de Riesgo

```bash
npm run evaluar-riesgo -- --reglas   # línea base: 10/10, 0-5 ms
npm run evaluar-riesgo               # con el modelo de LLM_MODELO
```

## Variables de entorno relevantes

Ver [`.env.ejemplo`](.env.ejemplo). Adicionales a la plantilla base: `URL_PROPIA`,
`URL_TALLER/TIENDA/CONCESIONARIO/PASARELA`, `NOTIFICACIONES_PERMITIDAS`, `PASARELA_LLAVE`,
`DB_*`, `OLLAMA_URL`/`EMBED_MODELO`/`EMBED_DIMENSIONES`/`LLM_MODELO`, y los parámetros
tributarios de respaldo (`IVA_PORCENTAJE`, `COMISION_PORCENTAJE`, `UVT`, `RETEFUENTE_*`).

## Utilidades internas (no son parte del contrato MCP)

- `GET /internos/cobro/pendientes`, `POST /internos/cobro/:venta_id/recordatorio`
- `GET /internos/conciliacion?dias=7`
- `GET /internos/cierre-contable?fecha=YYYY-MM-DD`
- `GET /internos/liquidacion/:venta_id/explicacion`
