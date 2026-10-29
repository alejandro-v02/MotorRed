# Pendientes de contrato — qué archivo editar cuando llegue cada información

Facturación (este servicio) está construida completa contra el contrato del Taller
(`Docs/Equipos/MCP-Taller.xlsx`) y probada de punta a punta con 56 escenarios
(`pruebas/escenarios-facturacion.mjs`). Todo lo que depende de un grupo del que aún no se tiene
información está detrás de un **puerto** (`src/facturacion/puertos.ts`) con un adaptador simulado que
funciona hoy y uno real que está por escribir. Cuando llegue la información, **se edita un archivo**; la
lógica (`cotizaciones.service.ts`), la base de datos, las herramientas MCP y las pruebas no cambian.

Convención: cada fila dice *qué falta saber*, *a quién preguntarle*, *qué archivo se edita* y *cómo se
activa*. Los valores de práctica que hoy usa el código están marcados con **[supuesto]**.

## 1. Tienda de repuestos (grupo José) y Concesionario (grupo Emerson)

| Qué falta saber | Archivo que se edita | Cómo se activa |
|---|---|---|
| Herramienta para consultar **precio y existencia por código universal** (`PAS-DEL-CER`…). El contrato 1.0 del kit consulta por *categoría + vehículo*. | `src/facturacion/adaptadores/tienda.real.ts` → `cotizar()` | `TIENDA_MODO=real` |
| Cómo se **compra** (el kit: `reservar_repuestos` + `confirmar_reserva`, con precio congelado y vencimiento). | `tienda.real.ts` → `comprar()` | igual |
| Cómo se **deshace** una compra (el kit: `liberar_reserva`). | `tienda.real.ts` → `liberar()` | igual |
| URL, credenciales y esquema de autenticación (OAuth `client_credentials` o token fijo). | `.env` (`URL_TIENDA`, `URL_CONCESIONARIO`, `CLIENTE_VENTAS_EN_TIENDA`…) y el constructor de `TiendaReal` (reutilizar `ClienteServicio`, ver `negocio/proveedores.service.ts`) | igual |
| Si la oferta trae **IVA** o lo aplicamos nosotros. | `OfertaRepuesto.iva_porcentaje` (`null` = IVA vigente de `parametros_tributarios`) | automático |
| Qué devuelve con **varias tiendas** y si el concesionario entra como proveedor de originales. | `tienda.real.ts` → `cotizar()` (hoy el simulado elige la más barata con existencias) | igual |
| Cómo viaja el **compra_id** que el Taller espera en `partes_usadas[].compra_id` (en el Excel es un entero). | `CompraRepuesto.compra_ref` en `puertos.ts` y `cotizaciones.service.ts` (`orden_compra`) | — |

Para probar mientras tanto: `datos/precios-simulados.json` (precios de práctica de los 15 códigos del catálogo).

## 2. Taller (grupo Falla)

El contrato ya está cubierto. Lo que falta confirmar con ellos:

| Qué falta saber | Dónde se refleja | Hoy |
|---|---|---|
| **URL del MCP del Taller** y **cómo se autentica Facturación** ante él. | `.env`: `TALLER_FACT_URL`, `TALLER_FACT_TOKEN`; `src/facturacion/adaptadores/taller.mcp.ts` | Token de portador fijo **[supuesto]**. Si es OAuth, pasar `clientId`/`clientSecret` a `ClienteServicio` y quitar `tokenFijo`. |
| Credencial con la que el Taller **nos** llama. | `.env`: `CLIENTE_TALLER_FACT_EN_VENTAS` | OAuth `client_credentials`, cliente `taller_fact` (`contrato/facturacion.ts` → `PERMISOS_FACTURACION`). Si el Taller usa un token fijo, agregar la verificación en `mcp/mcp.controller.ts`. |
| Si el Taller envía un **`traza_id`**. El Excel no lo trae. | `cotizaciones.service.ts` → `crearCotizacion` genera uno propio | **[supuesto]** Se genera al recibir la orden. Si el Taller lo envía, agregarlo a `CrearCotizacionEntrada` y usarlo. |
| Cómo calcula **`total_mano_obra_cliente`** (¿con o sin IVA?). | `crearCotizacion` lo compara con el cálculo propio y, si difiere, lo deja en la bitácora (`total_mano_obra_cliente_difiere`) | **[supuesto]** El precio de mano de obra viene **sin IVA**; se usa el cálculo propio. |
| Qué hacer cuando **no hay un repuesto**. El Excel no tiene una herramienta para avisar. | `cotizaciones.service.ts` → `cotizar()` (rama `fallos`) | La cotización queda en `sin_precio` para una persona. Alternativa: responder `registrar_respuesta_cliente` con `aceptada=false` y motivo. |
| Si **otros datos** de la misma orden (cambio de trabajo) deben reabrir la cotización. | `crearCotizacion` | Misma orden con otros datos = `IDEMPOTENCIA_CONFLICTO` **[supuesto]**. |
| Errores de negocio del Taller que **no se deben reintentar** (hoja Errores). | `taller.mcp.ts` / `mcp/cliente-servicio.ts` | Se reintenta lo que el Taller marque `reintentable`. |
| Si el Taller expone un endpoint de **eventos** (hoy no aparece en el Excel). | `config.ts` → `FACTURACION.urlEventosVenta` | Los eventos de venta se quedan en `POST /internos/eventos-venta` (sumidero). |

## 3. Cliente: Telegram

| Qué falta saber | Archivo | Cómo se activa |
|---|---|---|
| ¿Bot de Telegram real o se queda la bandeja simulada? El Excel dice que Facturación avisa por Telegram, pero no define el bot. | `src/facturacion/adaptadores/notificador.telegram.ts` (pasos escritos en el archivo) | `NOTIFICADOR_MODO=telegram` y `TELEGRAM_BOT_TOKEN` en `.env` |

La respuesta del cliente **ya tiene su único punto de entrada**: `POST /internos/cotizaciones/:codigo/respuesta`
con `{ aceptada, motivo? }` y la cabecera `X-Llave-Interna`. El bot, la app o un operador solo llaman ahí.

## 4. Reglas de negocio por decidir (afectan al código de Facturación)

| Decisión | Dónde cambiaría | Hoy **[supuesto]** |
|---|---|---|
| **IVA**: 19 % sobre mano de obra y repuestos. ¿Los repuestos en garantía llevan IVA? | `ParametrosService` (tabla `parametros_tributarios`, sin tocar código) y `cotizaciones.service.ts` → `totales()` | 19 % por línea para todo. |
| **Garantía**: ¿cómo se le cobra al fabricante/tienda/taller? Hoy las líneas que paga un tercero **salen del cobro al cliente** y se informan en `total_cubierto_garantia`, pero **no se dispersan ni se asientan**. | `cotizaciones.service.ts` → `notificarReparacionTerminada` (líneas con `pagador` distinto de `cliente`) y `negocio/dinero.service.ts` | Sin dispersión al tercero. |
| **Cliente retenedor**: el Taller no envía si el cliente es agente de retención. | `.env` `CLIENTE_RETENEDOR` | 0 (persona natural). |
| **Vigencia** de la cotización. | `.env` `COTIZACION_VIGENCIA_HORAS` | 48 horas. |
| Beneficiario de un repuesto cuando la **tienda** es un nombre comercial (`"AutoPartes La 68"`) y la dispersión solo conoce `tienda` / `concesionario`. | `puertos.ts` → `OfertaRepuesto.proveedor` | La tienda declara `tienda` o `concesionario`. |
| **Cierre contable**: ¿el PSE es la pasarela del kit? | `config.ts` → `URLS.pasarela` | Sí, la pasarela simulada. |

## 5. Cómo verificar después de cada cambio

```bash
npm run build
npm run migration:run                                  # solo si cambió el esquema
node pruebas/simulador-taller-facturacion.mjs &        # Taller simulado (:4111)
npm start                                              # con TALLER_FACT_URL=http://localhost:4111
node pruebas/escenarios-facturacion.mjs                # 56 pruebas de Facturación
node ../ecosistema-motor/pruebas/conformidad.mjs ventas --url http://localhost:3010   # contrato 1.0: 58/58
node ../ecosistema-motor/pruebas/escenarios.mjs                                      # 79/79
```

Con el Taller real: quitar el simulado, poner su URL y credenciales en `.env`, y repetir los escenarios
de `F1` a `F9` contra él. Si algún escenario falla solo con el real, el desajuste está en la tabla 2.
