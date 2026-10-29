# Informe técnico — Ventas y contabilidad (grupo Zaidy)

**Proyecto integrador MotorRed — Instructivo 5.** Documento único que reúne el diseño, las
decisiones de arquitectura y el informe de pruebas (Trabajo 8) del servicio de Ventas. Los
archivos fuente de cada sección siguen existiendo por separado en `docs/` para quien prefiera
leerlos sueltos; este documento es la versión consolidada para exportar a PDF.

**Repositorio:** `motorred-ventas/`. **Versión del contrato:** 1.0. **Fecha:** 29 de octubre de 2026.

---

## Índice

1. Modelo de datos
2. Registros de decisión de arquitectura (ADR)
3. Fichas de los agentes
4. Informe de pruebas (Trabajo 8)
   1. Funcionalidad
   2. Conformidad
   3. Rendimiento
   4. Acceso y seguridad
   5. Conectividad y trazabilidad
   6. Calidad de los agentes
5. Plan de migración y respaldo de la base de datos

---

# 1. Modelo de datos

Trabajo 2, Paso 2. Una base de datos PostgreSQL propia de este servicio; nadie más la lee
directamente, todo pasa por el contrato MCP.

## Tablas

| Tabla | Para qué | Columnas clave |
|---|---|---|
| `ventas` | Una fila por venta del contrato. | `venta_id` (PK, `V-000001`…), `traza_id`, `orden_id`, `estado` (`ESTADOS_VENTA`), `pagador` (jsonb), montos en enteros, `url_pago`, `url_notificacion`, `cobro_id`/`motivo` (internos, no se publican), `liquidada` |
| `lineas_venta` | Las líneas de cada venta. | `venta_id` (FK), `beneficiario`, `concepto`, `referencia`, `cantidad`, `precio_unitario`, `iva_porcentaje`, `reserva_id` |
| `cobros` | Un registro por cada cobro pedido a la pasarela (`generar_cobro` crea uno nuevo tras un rechazo). | `cobro_id` (PK), `venta_id`, `monto`, `estado`, `url_pago` |
| `eventos_pasarela` | Idempotencia del webhook: un `evento_id` se procesa una sola vez. | `evento_id` (PK), `cobro_id`, `tipo`, `monto`, `resultado` |
| `dispersiones` | Cuánto le toca a cada beneficiario de una venta liquidada. | `venta_id` (FK), `beneficiario`, `base`, `iva`, `retencion`, `comision`, `iva_comision`, `neto` |
| `asientos` | Partida doble de cada venta liquidada (PUC ilustrativo). | `venta_id` (FK), `cuenta`, `nombre_cuenta`, `tercero`, `debito`, `credito` |
| `parametros_tributarios` | Tarifas y bases **con vigencia** (nunca en el código). | `concepto`, `tarifa`, `base_uvt`, `valor`, `vigente_desde`, `vigente_hasta` |
| `claves_idempotencia` | Idempotencia de `crear_venta`: misma clave + misma huella = mismo resultado. | `cliente`, `clave` (PK compuesta), `huella`, `venta_id` |
| `reservas_venta_activas` | Qué venta es dueña de cada `reserva_id` mientras sigue viva. | `reserva_id` (PK), `venta_id` |
| `fragmentos_conocimiento` | Base de conocimiento del RAG (Actividad 4.4): política de cobro y de conciliación. | `titulo`, `contenido`, `fuente`, `embedding vector(768)` |
| `decisiones_riesgo` | Bitácora de cada decisión del agente de Riesgo. | `venta_id`, `nivel_riesgo`, `motivos` (jsonb), `fuente` (`modelo`/`plan_b`), `tiempo_ms` |

Migración completa: `src/db/migraciones/0001_inicial.ts`.

### Por qué `reservas_venta_activas` en vez de un campo en `lineas_venta`

El simulador de referencia (`ventas.mjs`) usa un `Map<reserva_id, venta_id>` en memoria para saber
si una reserva ya pertenece a otra venta, y evitar que dos ventas se queden con la misma reserva
si llegan casi al mismo tiempo. Una tabla aparte con `reserva_id` como llave primaria logra lo
mismo mejor que un `Map`: la restricción `UNIQUE` la aplica PostgreSQL, así que dos `crear_venta`
simultáneas para la misma reserva no pueden ganar las dos, aunque corrieran en procesos distintos.

### `pagador` como `jsonb` en vez de una tabla aparte

`pagador` no se normalizó en una tabla `pagadores` porque el contrato lo trata como un objeto
embebido en cada venta (no hay un `pagador_id` en ningún otro lado del contrato), y porque el
agente de Riesgo solo necesita consultarlo por `documento` dentro de la misma venta
(`pagador ->> 'documento'`, con un índice GIN si el volumen lo exige más adelante). Si en el futuro
se necesita un perfil de cliente con más historial que el que cabe en `ventas`, esa sería una
buena razón para extraerlo a su propia tabla.

---

# 2. Registros de decisión de arquitectura (ADR)

## ADR 0001 — Modelo de datos de Ventas

**Estado:** aceptado · **Fecha:** 2026-10-28

**Contexto.** Ventas es el orquestador comercial: crea la venta, la cobra, confirma reservas en
otros dos servicios externos (tienda y concesionario), y liquida y dispersa el dinero. Necesita
persistir todo eso en PostgreSQL de forma que sobreviva un reinicio del proceso y que dos
peticiones concurrentes nunca produzcan un doble cobro o una reserva vendida dos veces.

**Decisión.**

1. Una tabla por entidad del contrato, en vez de guardar `lineas`, `dispersiones` y `asientos`
   como arreglos `jsonb` dentro de `ventas`. Permite consultarlos con SQL normal (el cierre
   contable agrupa `dispersiones` por beneficiario con un `GROUP BY`) y mantiene la integridad
   referencial con `ON DELETE CASCADE`.
2. `pagador` sí se guarda como `jsonb` dentro de `ventas`, porque el contrato no le da un id
   propio en ningún otro punto del sistema.
3. Idempotencia con dos mecanismos combinados: un `Map` en memoria de promesas en vuelo (igual
   que el simulador de referencia) para serializar peticiones concurrentes con la misma clave
   dentro de este proceso, y la tabla `claves_idempotencia` para que una repetición sobreviva a
   un reinicio del servicio.
4. `reservas_venta_activas` como tabla con `reserva_id` de llave primaria, en vez de confiar solo
   en la verificación de precio contra el proveedor: la restricción `UNIQUE` hace que, si dos
   ventas reclaman la misma reserva casi al mismo tiempo, la segunda falle de forma controlada.
5. `parametros_tributarios` con vigencia (`vigente_desde`/`vigente_hasta`) en vez de constantes en
   `config.ts`: las tarifas cambian por decreto, así que un cambio de tarifa es una fila nueva, no
   un despliegue.

**Alternativas consideradas.** Guardar todo en `ventas` como `jsonb` (descartado: dificulta el
cierre contable y la conciliación). Confiar solo en el `Map` en memoria para la idempotencia, sin
tabla (descartado: no sobrevive un reinicio del proceso).

**Consecuencias.** El esquema solo funciona correctamente con una única instancia del servicio
corriendo a la vez (el `Map` en memoria no se comparte entre réplicas); escalar horizontalmente
requeriría mover el candado de idempotencia a un `SELECT ... FOR UPDATE` o un advisory lock de
PostgreSQL — riesgo pendiente documentado para la sustentación. Cada liquidación exitosa escribe
en tres tablas dentro de una sola transacción, así que la base nunca queda con una liquidación a
medias.

## ADR 0002 — Qué decide el agente y qué decide el código

**Estado:** aceptado · **Fecha:** 2026-10-28

**Contexto.** Ventas mueve dinero. El Instructivo 5 es explícito en que "el agente propone, el
código dispone" y en que "ningún agente crea, cambia ni anula ventas o dispersiones". Había que
decidir, agente por agente, dónde está esa línea.

**Decisión.**

| Agente | Qué decide el agente | Qué decide el código |
|---|---|---|
| **Riesgo** | Clasifica bajo/medio/alto con motivos, a partir de datos ya verificados. | Si el nivel es "alto", el código decide NO llamar a la pasarela y deja la venta en `en_revision`. |
| **Cobro** | Redacta el texto del recordatorio. | El monto y la `url_pago` salen siempre de la base de datos, nunca del modelo. |
| **Conciliación** | Nada numérico: el cálculo de cada diferencia es una consulta SQL determinista. | El agente solo usa el RAG para citar la política. |
| **Contable** | Explica una liquidación en lenguaje llano y arma el resumen del cierre. | Los valores ya los calculó `DineroService.liquidar()`; el agente solo los lee y los redacta. |

La saga completa (confirmar reservas, liquidar, dispersar, compensar) vive en
`VentasService.alAprobarse()`, como una máquina de estados escrita en código: ningún modelo decide
cuándo una venta pasa de `pagada` a `liquidada` o a `reembolsada`.

**Por qué el cálculo de dinero nunca pasa por un modelo.** Cualquier número que termine en una
dispersión o un asiento contable es aritmética sobre datos que ya pasaron por las verificaciones
del contrato. Pedirle a un modelo que sume o decida una retención introduciría un error sin un
plan B razonable ("el error no te dice la cuenta correcta"). El único lugar donde un modelo
clasifica algo que de verdad podría equivocarse en cualquier dirección es el riesgo de una venta,
que es justamente donde sí hay una baranda (plan B + revisión humana) que absorbe el error.

**Consecuencias.** El agente de Riesgo es el único que puede cambiar el camino que sigue una venta
real; por eso es también el único con evaluación formal y bitácora propia. Los otros tres agentes
son deliberadamente de solo lectura: se pueden apagar sin que el ecosistema deje de funcionar.

---

# 3. Fichas de los agentes

Trabajo 2, Paso 3.

## Riesgo

| Campo | Detalle |
|---|---|
| **Objetivo** | Clasificar el riesgo de una venta (bajo/medio/alto) antes de generar el cobro. |
| **Herramientas que puede usar** | Ninguna. No llama ninguna herramienta MCP: recibe datos ya verificados por `VentasService` y solo clasifica. |
| **Entrada** | `{ monto_a_pagar_cop, tipo_pagador, pagador_agente_retencion, cantidad_lineas, ventas_aprobadas_previas_de_este_pagador, rechazos_previos_de_este_pagador }` |
| **Salida** | `{ nivel_riesgo: "bajo"\|"medio"\|"alto", motivos: string[], confianza: number }` |
| **Barandas** | Salida estructurada con zod; tiempo máximo 8 s; plan B por reglas si el modelo falla, no responde a tiempo o no produce JSON válido; el agente nunca cambia el estado de una venta, solo clasifica. |
| **Cuándo pide un humano** | Siempre que clasifica "alto": el código deja la venta en `en_revision` sin generar el cobro. |
| **Cómo se evalúa** | `docs/casos-riesgo.json` (10 casos) + `npm run evaluar-riesgo [--reglas]`, con las métricas ACIERTO / PELIGROSO / conservador. |

## Cobro

| Campo | Detalle |
|---|---|
| **Objetivo** | Redactar el recordatorio de pago de una venta `pendiente_pago` con más de 30 minutos. |
| **Herramientas que puede usar** | Ninguna de escritura. Solo lee `ventas` y el RAG de política de cobro. |
| **Entrada** | `venta_id` |
| **Salida** | `{ venta_id, mensaje, fuentes }` |
| **Barandas** | "Cifras y enlaces con respaldo": el monto y la `url_pago` siempre se toman de la base de datos. |
| **Cuándo pide un humano** | Nunca por sí solo: el recordatorio es informativo. |
| **Cómo se evalúa** | Prueba manual: `GET /internos/cobro/pendientes`, `POST /internos/cobro/:venta_id/recordatorio`. |

## Conciliación

| Campo | Detalle |
|---|---|
| **Objetivo** | Comparar ventas, cobros/eventos de la pasarela y asientos contables, y reportar diferencias. |
| **Herramientas que puede usar** | Ninguna de escritura. Solo lee las tablas propias y el RAG de política de conciliación. |
| **Entrada** | `dias` (ventana de tiempo a revisar) |
| **Salida** | `{ generado_en, ventas_revisadas, diferencias, fuentes }` |
| **Barandas** | El cálculo de cada diferencia es SQL determinista; el RAG solo aporta la cita de la política. |
| **Cuándo pide un humano** | Siempre: el reporte en sí es la señal para que una persona revise. |
| **Cómo se evalúa** | `GET /internos/conciliacion`, comparado contra datos con diferencias forzadas. |

## Contable

| Campo | Detalle |
|---|---|
| **Objetivo** | Explicar una liquidación en lenguaje llano y armar el cierre del día. |
| **Herramientas que puede usar** | Ninguna de escritura. Solo lee `dispersiones`, `asientos` y el RAG de política contable. |
| **Entrada** | `venta_id` o `fecha` |
| **Salida** | Explicación de una liquidación o resumen del cierre del día. |
| **Barandas** | Nunca recalcula un valor: los toma tal cual de lo que `DineroService.liquidar()` ya escribió. |
| **Cuándo pide un humano** | Cuando reporta ventas `en_revision` en el cierre del día. |
| **Cómo se evalúa** | `GET /internos/cierre-contable`, `GET /internos/liquidacion/:venta_id/explicacion`. |

---

# 4. Informe de pruebas (Trabajo 8)

Corridas reales contra este servicio (no el simulador), con los cuatro simuladores de referencia
de `ecosistema-motor` como taller/tienda/concesionario/pasarela, Node.js 24, Docker (PostgreSQL 16
+ pgvector) y Ollama.

## 4.1 Funcionalidad

```
node pruebas/escenarios.mjs   →  RESUMEN DE ESCENARIOS: 79 de 79 pruebas correctas
```

Los seis escenarios (E1 normal, E2 garantía con dos pagadores, E3 pago rechazado y nuevo cobro, E4
compensación por reserva vencida, E5 retención en la fuente, E6 seguridad) pasan completos contra
este servicio real conectado a los simuladores de taller, tienda, concesionario y pasarela.

**Dos fallas reales encontradas y corregidas durante esta corrida:**

1. Una venta con varias líneas que comparten una misma reserva (p. ej. bujías y bobina,
   reservadas juntas en la tienda) intentaba reclamar esa reserva dos veces dentro de la misma
   transacción, chocando con su propia restricción `UNIQUE`. Corregido deduplicando por
   `reserva_id` antes de reclamar.
2. Los eventos de bitácora `webhook_duplicado_ignorado` y `venta_liquidada` se registraban con el
   campo `herramienta` en vez de `evento`, así que no aparecían en `GET /bitacora`. Corregido en
   todos los puntos de `VentasService`.

## 4.2 Conformidad

```
node pruebas/conformidad.mjs ventas --url http://localhost:3000
→ CONFORMIDAD DE VENTAS: 58 de 58 pruebas correctas
```

Las 58 pruebas cubren: salud y versión del contrato, OAuth y alcances, publicación de
herramientas por cliente con sus esquemas exactos, y las reglas de negocio (idempotencia simple y
simultánea, verificación de precios contra la reserva, retenciones, partida doble, anulación,
firma del webhook). Detalle en `resultados/conformidad-ventas.csv`.

**También verificado dentro de Docker:** `docker compose build && docker compose up -d` levanta
el servicio y su propia base de datos; tras correr las migraciones y el seed dentro del
contenedor, la misma conformidad da **58/58 contra el contenedor**, incluida la liquidación real
vía pasarela → webhook → saga. Única corrección necesaria: si la pasarela corre fuera de este
compose (en el host), `URL_PROPIA` debe apuntar a `http://localhost:<puerto publicado>`, no a
`host.docker.internal` (que solo resuelve contenedor → host, no al revés). El valor por defecto
del compose (`http://ventas:3000`) es el correcto para cuando los cuatro servicios y la pasarela
corran juntos en el mismo compose (Trabajo 7, Paso 3).

## 4.3 Rendimiento

Dos corridas reales de `node pruebas/carga.mjs 20 5`, con la única diferencia de qué modelo
contesta en `LLM_MODELO`.

**Corrida A — `LLM_MODELO=llama3.2` (modelo instalado y disponible):** 20 órdenes, 5 en paralelo,
20 completas, 0 con error, 50.1 s, **24 órdenes por minuto**.

| Paso | p50 ms | p95 ms | máx ms |
|---|---|---|---|
| registrar_ingreso | 182 | 3452 | 3452 |
| diagnosticar | 52 | 1748 | 1748 |
| cotizar | 411 | 3613 | 3613 |
| aprobar_opcion | 8945 | 9409 | 9409 |
| pago_hasta_liquidacion | 705 | 9538 | 9538 |

**Corrida B — `LLM_MODELO=qwen2.5:7b` (el valor por defecto de `.env.ejemplo`, no instalado en
Ollama en esta máquina):** 20 órdenes, 5 en paralelo, 20 completas, 0 con error, 6.0 s,
**199 órdenes por minuto**.

| Paso | p50 ms | p95 ms | máx ms |
|---|---|---|---|
| registrar_ingreso | 202 | 336 | 336 |
| diagnosticar | 56 | 141 | 141 |
| cotizar | 351 | 568 | 568 |
| aprobar_opcion | 407 | 920 | 920 |
| pago_hasta_liquidacion | 392 | 661 | 661 |

**De dónde sale la diferencia con los simuladores** (~1100 órdenes/minuto en el kit): los
simuladores no llaman PostgreSQL ni ningún modelo. Aquí, `aprobar_opcion` incluye la llamada de
`crear_venta`, que antes de cobrar evalúa el riesgo con el agente de IA.

**Por qué la corrida A es ~22 veces más lenta que la B, con el mismo código:** con `llama3.2`
(instalado), Ollama sí responde, pero el modelo nunca contesta dentro del tiempo máximo de 8 s
configurado a propósito para esta ruta síncrona: el agente espera los 8 s completos antes de caer
al plan B. Con `qwen2.5:7b` (no instalado), Ollama responde de inmediato con "modelo no
encontrado", así que el agente cae al plan B casi sin esperar. La lección no es "usar un modelo
que falle": es que el tiempo máximo y el plan B protegen el tiempo de respuesta sin importar POR
QUÉ el modelo no contestó a tiempo.

**Qué se haría para reducirla de verdad** (con un modelo que sí responda y sea útil): instalar y
usar un modelo con mejor soporte de salida estructurada y más rápido (`qwen2.5:7b` o `qwen3:8b`,
o el proveedor en la nube), o evaluar el riesgo de forma asíncrona después de responder al taller
cuando el nivel resulta "bajo" en el plan B rápido, bloqueando de forma síncrona solo los casos
que superan el umbral medio.

## 4.4 Acceso y seguridad

El escenario **E6 seguridad** (13 pruebas, todas correctas) cubre: credenciales de servicio
equivocadas, un cliente pidiendo un alcance que no le corresponde, tokens alterados, webhooks con
firma inválida o reenviados (más de 5 minutos), un intento de cobrar un precio distinto al de la
reserva real, repuestos haciéndose pasar por garantía gratis, reutilizar una clave de idempotencia
con otros datos, `url_notificacion` fuera del ecosistema (SSRF), cuatro `crear_venta` simultáneas
con la misma clave (una sola venta), usar en otra venta una reserva que ya tiene dueña, consultar
con la traza de otra orden, una oferta inventada, y liberar una reserva ya pagada y confirmada.

Tres ataques propios adicionales, ejecutados manualmente con `pruebas/verificar-ataques.mjs`:

| Ataque | Resultado esperado | Resultado obtenido |
|---|---|---|
| Crear una venta con `pagador.tipo=concesionario` sin `autorizacion` `GAR-...` | `DATOS_INVALIDOS` | `DATOS_INVALIDOS` |
| Llamar `consultar_liquidacion` de una venta `pendiente_pago` | `ESTADO_INVALIDO` | `ESTADO_INVALIDO` |
| Webhook con `evento_id` nuevo pero un `cobro_id` inventado | Se ignora sin tocar la venta | HTTP 200, `{"ignorado":"cobro desconocido o reemplazado"}` |
| El mismo `evento_id`, reenviado con un `monto` distinto | Se descarta como duplicado por `evento_id` | HTTP 200, `{"duplicado": true}` |

## 4.5 Conectividad y trazabilidad

`node pruebas/traza.mjs` reconstruye la orden en los cinco servicios por
`GET /bitacora?traza_id=`, incluido este servicio: cada `crear_venta`, `generar_cobro`,
`anular_venta`, cada webhook de la pasarela y cada evento de negocio (`venta_liquidada`,
`saga_compensacion`, `venta_en_revision`) queda en la bitácora con su `traza_id`, consultable por
el cliente `auditor`. Confirmado en los 79/79 de `escenarios.mjs`.

## 4.6 Calidad de los agentes

### Riesgo (único agente con evaluación formal)

| Corrida | Acierto | Peligrosos | Conservadores | Plan B usado | Latencia p50 / máx |
|---|---|---|---|---|---|
| `--reglas` (línea base, sin modelo) | 10/10 | 0 | 0 | — | 0 ms / 5 ms |
| Con modelo, tiempo máximo 120 s (antes de acotarlo) | 6/10 | **0** | 4 | 3/10 | 79 521 ms / 120 077 ms |
| Con modelo, tiempo máximo 8 s (configuración final) | 10/10 | 0 | 0 | **10/10** | 8040 ms / 8442 ms |

**Lectura.** Con `llama3.2` y 120 s de margen, el modelo acierta 6/10 y nunca falla de forma
peligrosa, pero tarda hasta 2 minutos — inaceptable para una ruta síncrona. Acotado a 8 s, el
modelo nunca alcanza a responder y el sistema cae siempre al plan B, que por sí solo ya acierta
10/10. Las barandas (plan B + tiempo máximo) son las que de verdad protegen el sistema con este
modelo; vale la pena repetir esta evaluación con `qwen2.5:7b` o `qwen3:8b` antes de la
sustentación.

### Cobro, Conciliación y Contable (sin evaluación formal: son de solo lectura)

Probados manualmente contra datos reales (32 ventas acumuladas):

- `GET /internos/cobro/pendientes` y `POST /internos/cobro/:venta_id/recordatorio`: el monto y el
  enlace coincidieron exactamente con los de la tabla `ventas`.
- `GET /internos/conciliacion`: sobre 32 ventas, `"diferencias": []`, ninguna falsa alarma.
- `GET /internos/cierre-contable`: reportó 27 ventas liquidadas y la dispersión correcta por
  beneficiario, sin ninguna `en_revision` pendiente.
- `GET /internos/liquidacion/:venta_id/explicacion`: coincidió exactamente con
  `consultar_liquidacion`.

---

# 5. Plan de migración y respaldo de la base de datos

## Migraciones

El esquema se gobierna por migraciones de TypeORM (`src/db/migraciones/`), nunca por
`synchronize: true`.

```
npm run migration:run       # aplica las migraciones pendientes, en orden
npm run migration:revert    # revierte la última migración (solo en desarrollo)
```

Cada migración nueva se agrega como un archivo más y se registra en `src/db/opciones.ts`. Nunca
se edita una migración ya aplicada en producción.

## Respaldo

Una base de datos por servicio: esta instancia de PostgreSQL solo contiene los datos de Ventas.

```
docker exec ventas-db pg_dump -U motorred -d motorred_ventas -F c -f /tmp/motorred_ventas.dump
docker cp ventas-db:/tmp/motorred_ventas.dump ./respaldo-$(date +%Y%m%d-%H%M).dump
```

**Frecuencia recomendada:** diario (al cierre del día), y antes de cualquier despliegue con una
migración nueva. Los respaldos nunca se suben al repositorio; se guardan fuera del control de
versiones con retención de al menos 30 días.

**Restaurar** (sobre una base de datos nueva, vacía):

```
docker exec -i ventas-db pg_restore -U motorred -d motorred_ventas --clean --if-exists < respaldo.dump
npm run migration:run   # por si el respaldo es de una versión anterior del esquema
```

## Recuperar una orden a partir de la bitácora

1. `GET /bitacora?traza_id=<traza_id>` con el token del cliente `auditor`.
2. Ubicar la línea `crear_venta` para saber el `venta_id`.
3. Seguir la secuencia de esa venta: `webhook cobro.aprobado`/`cobro.rechazado`,
   `venta_liquidada` o `saga_compensacion`/`venta_en_revision`.
4. Cruzar el `venta_id` contra `consultar_venta` y `consultar_liquidacion` para el detalle.
5. `node pruebas/traza.mjs <traza_id>` (en `ecosistema-motor`) arma la línea de tiempo completa
   cruzando la bitácora de los cinco servicios a la vez.

La bitácora vive en memoria y se reinicia con el proceso; el respaldo a largo plazo son las
tablas `ventas`, `lineas_venta`, `cobros`, `eventos_pasarela`, `dispersiones` y `asientos`, que sí
persisten en PostgreSQL.
