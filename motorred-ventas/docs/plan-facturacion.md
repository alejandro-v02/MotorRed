# Plan de trabajo: completar Facturación (servicio Ventas)

Supuesto: el Excel `MCP-Taller.xlsx` del grupo Falla es el contrato vigente con el Taller. El plan parte de
lo que ya existe en `motorred-ventas` (conformidad 58/58, escenarios 79/79, saga, agentes, Docker e informe).

## Estado (29 oct 2026)

La estructura completa de las fases 1 a 4 está construida y probada con un Taller simulado y una tienda
simulada: **56 de 56** escenarios de Facturación (`pruebas/escenarios-facturacion.mjs`) y el contrato 1.0
sigue en **58/58** (conformidad) y **79/79** (escenarios del kit). Lo que depende de otros grupos quedó
detrás de adaptadores que se completan editando un archivo cada uno:
[`pendientes-contratos.md`](pendientes-contratos.md).

| Fase | Estado |
|---|---|
| 0. Contratos y Ollama | Pendiente: contratos de Tienda y Concesionario, decisiones de la sección «Decisiones pendientes» y Ollama (ver más abajo) |
| 1. Cotizar | Hecha con tienda simulada |
| 2. Respuesta del cliente | Hecha (bandeja de salida con reintentos, vencimiento, compensación) |
| 3. Cobro al terminar | Hecha (PSE con la pasarela simulada, garantía parcial y total) |
| 4. Pruebas y seguridad | Hecha: simulador del Taller y 56 escenarios. Falta evaluar los agentes con Ollama |
| 5. Integración y entrega | Pendiente: Taller real, informe técnico y etiqueta |

## Fase 0: Cerrar lo que falta antes de programar (½ día)

| # | Tarea | Resultado |
|---|---|---|
| 0.1 | Pedir a José el contrato de la Tienda (el Excel equivalente) y a Emerson el del Concesionario. | Se sabe cómo consultar precios y cómo comprar. |
| 0.2 | Pedir la solicitud de cambio del contrato del Taller, o la confirmación del instructor. | La divergencia con el contrato 1.0 queda documentada y aprobada. |
| 0.3 | Decidir con el equipo el IVA, Telegram, PSE y la vigencia de la cotización (ver «Decisiones»). | Reglas fijas antes de tocar el código. |
| 0.4 | Instalar Ollama y bajar `nomic-embed-text` y `qwen2.5:7b`. Correr `npm run seed`. | El RAG y la evaluación del agente de riesgo funcionan; el punto 4.4 del Instructivo queda cubierto. |

## Fase 1: Cotizar (el cambio principal, 2 días)

1. **Migración `0002_cotizaciones`.** Tablas `cotizaciones` y `lineas_cotizacion`.
   - Estados: `en_cotizacion → aceptada | rechazada | vencida | cancelada`.
   - Cada línea guarda su origen (mano de obra o repuesto) y su pagador (`cliente`, `fabricante`, `tienda` o `taller`).
   - La clave única es el código de la orden.
2. **Herramienta `crear_cotizacion`.** Recibe lo que manda el Taller: `mano_obra[]` con precio, `repuestos[]` sin precio, la garantía y el cliente.
   - Es idempotente por código de orden.
   - Responde de inmediato «recibida» y procesa en segundo plano.
3. **Buscar precios en las tiendas.** Cliente MCP hacia Tienda y Concesionario con el código universal de repuesto.
   - Elige la mejor oferta por repuesto y registra qué tienda ganó y por qué.
   - Si no hay stock, deja la línea marcada y avisa.
4. **Calcular el total.** Con `dinero.service`: IVA, totales y lo que paga el cliente después de descontar la garantía válida.
5. **Aviso al cliente.** Un componente de notificación con el `mensaje_garantia` y el total, simulado o real según 0.3.

**Aceptación:** una cotización con garantía parcial da el total correcto al peso, y repetirla con la misma clave no duplica nada.

## Fase 2: Respuesta del cliente (1 día)

1. **Herramienta o endpoint** para registrar la respuesta del cliente (aceptó o rechazó).
2. **Comprar con las tiendas** (reservar y confirmar) solo cuando acepta, con el precio congelado y verificando contra la oferta (`PRECIO_NO_COINCIDE`).
3. **Cliente MCP hacia el Taller**, con `registrar_respuesta_cliente { codigo, aceptada, referencia, orden_compra[], id_mensaje }`.
   - Los reintentos usan el mismo `id_mensaje`.
   - Si el Taller no responde, la respuesta queda en una bandeja de salida y se reintenta hasta cinco veces.
4. **Si rechaza:** liberar cualquier reserva, avisar al Taller y cerrar la cotización.
5. **Si la oferta venció antes de aceptar:** recotizar (compensación, como el escenario E4).

**Aceptación:** una cotización aceptada deja la orden en `aprobada`; una rechazada, en `rechazada`. Un fallo del Taller no pierde la respuesta.

## Fase 3: Cobro al terminar la reparación (1½ días)

1. **Herramienta `notificar_reparacion_terminada`.** Recibe lo realmente hecho: mano de obra realizada, servicios no realizados y partes usadas.
2. **Recalcular el cobro final.** Los servicios no realizados se descuentan y se verifica contra la cotización aceptada.
3. **Cobro por PSE.** Reutilizar la pasarela simulada de Ventas, con su webhook firmado e idempotente.
4. **`registrar_pago { codigo, referencia_pse, valor, id_mensaje }`** hacia el Taller cuando se confirma el pago.
5. **Liquidación y dispersión** reutilizan lo existente: retención, comisión 3 %, asientos en partida doble y pago a cada beneficiario. Se suma el pagador de garantía (fabricante, tienda o taller).
6. **Un pago rechazado** genera un nuevo cobro, como en el escenario E3.

**Aceptación:** la suma de netos y de la plataforma es igual a lo recaudado; los débitos y los créditos cuadran.

## Fase 4: Pruebas, agentes y seguridad (1½ días)

| Entregable | Detalle |
|---|---|
| Simulador del Taller | Simulador mínimo según el Excel (`crear_cotizacion` y `notificar_reparacion_terminada` hacia nosotros; `registrar_respuesta_cliente` y `registrar_pago` hacia ellos). Permite probar sin esperar al grupo Falla. |
| Conformidad | Ampliar las pruebas con el contrato nuevo. La 1.0 se mantiene en verde. |
| Escenarios nuevos | Cotización normal, con garantía, rechazo, oferta vencida, pago rechazado y reintentos del Taller. |
| Seguridad | Tres ataques nuevos: `crear_cotizacion` con precio alterado, repuesto que se hace pasar por garantía y la misma cotización desde otro cliente. |
| Agentes | Ajustar Cobro y Contable a la cotización y evaluar con Ollama contra la línea base de reglas. |
| Carga | Repetir `carga.mjs` y comparar contra la corrida anterior. |

## Fase 5: Integración y entrega (1 día)

1. Cambiar el simulador del Taller por el servicio real del grupo Falla y probar con la traza completa.
2. Actualizar el `docker-compose.yml`, el README y el modelo de datos.
3. Actualizar el informe técnico: modelo de datos, ADR nuevo («cotización antes de venta») y resultados medidos.
4. Etiquetar el repositorio (`conformidad-1.1` o la que se acuerde).
5. Ensayar la sustentación con un pago rechazado y una oferta vencida.

## Reparto sugerido (4 integrantes)

| Rol | Tareas |
|---|---|
| Líder técnico e integración | 0.1 a 0.3, 1.2, 2.3 y 5.1 |
| Dominio y datos | 1.1, 1.4, 3.2 y 3.5 |
| Agentes de IA | 0.4, 1.5 y los agentes de la fase 4 |
| Calidad y seguridad | El simulador, la conformidad, los escenarios, los ataques y el informe |

## Tiempo estimado

Alrededor de 7 días de trabajo en equipo, sin contar las esperas por los contratos de la Tienda y del Concesionario.

## Decisiones pendientes

1. **IVA:** ¿19 % sobre mano de obra y repuestos? ¿Qué pasa con las líneas pagadas por garantía? Por defecto: 19 % por línea; las líneas que no paga el cliente las asume el pagador.
2. **Telegram:** ¿bandeja simulada o bot real? Recomendado: bandeja simulada con una ruta que la prueba pueda leer.
3. **PSE:** ¿sirve la pasarela del kit? Recomendado: sí.
4. **Vigencia de la cotización:** propuesta de 48 horas.
