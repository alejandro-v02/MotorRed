# Automatización de Telegram con n8n

Reemplaza el "SIMULADO Telegram" del log por un bot de Telegram real, orquestado por n8n. El
código ya está listo del lado de nuestro servicio (`TelegramSimuladoService`); esto es la parte
que arman en n8n.

## Cómo encajan las piezas

```
Taller → crear_cotizacion → nosotros calculamos la cotización
                                   │
                                   ▼ (si N8N_WEBHOOK_COTIZACION está configurado)
                         POST a n8n: "cotizacion_creada"
                                   │
                           n8n manda el Telegram
                                   │
                        el cliente responde SÍ/NO
                                   │
                                   ▼
     n8n llama: POST /facturacion/sandbox/telegram/<cotizacion_ref>/responder
                                   │
                    nosotros avisamos al taller (registrar_respuesta_cliente)
```

Lo mismo para el pago, con `N8N_WEBHOOK_PAGO` y
`POST /facturacion/sandbox/pse/<referencia_pse>/confirmar`.

## 1. Configura las variables en `.env`

```
N8N_WEBHOOK_COTIZACION=http://localhost:5679/webhook/motorred-cotizacion
N8N_WEBHOOK_PAGO=http://localhost:5679/webhook/motorred-pago
```

(`5679` es el puerto donde mapeaste `mp-n8n`; ajústalo si es otro.)

## 2. JSON que NOSOTROS le mandamos a n8n (webhook saliente)

**Cuando se crea una cotización** (`N8N_WEBHOOK_COTIZACION`):
```json
{
  "evento": "cotizacion_creada",
  "cotizacion_ref": "FAC-OT-0054-mvwfg7ne",
  "codigo": "OT-0054",
  "cliente": { "cedula": "39765432", "nombre": "Marta Gil", "telefono": "3009998877" },
  "mensaje": "Hola Marta Gil, tu cotización para ... es de $498.300. ... Responde SÍ o NO.",
  "total_a_pagar": 498300
}
```

**Cuando hay que cobrar** (`N8N_WEBHOOK_PAGO`):
```json
{
  "evento": "pago_pendiente",
  "cotizacion_ref": "FAC-OT-0054-mvwfg7ne",
  "codigo": "OT-0054",
  "cliente": { "cedula": "39765432", "nombre": "Marta Gil", "telefono": "3009998877" },
  "mensaje": "Hola Marta Gil, tu reparación ... Paga aquí: http://localhost:3000/facturacion/sandbox/pse/PSE-.../pagina",
  "referencia_pse": "PSE-1793306026830f5e2",
  "valor": 592977,
  "url_pago": "http://localhost:3000/facturacion/sandbox/pse/PSE-.../pagina"
}
```

## 3. JSON que N8N nos tiene que mandar de vuelta

**Respuesta del cliente a la cotización:**
```
POST http://localhost:3000/facturacion/sandbox/telegram/<cotizacion_ref>/responder
Content-Type: application/json

{ "aceptada": true, "motivo": "opcional, solo si aceptada es false" }
```

**Confirmación del pago** (no necesita cuerpo):
```
POST http://localhost:3000/facturacion/sandbox/pse/<referencia_pse>/confirmar
```

## 4. El problema real de Telegram que tienes que resolver en n8n (no es de nuestro código)

Un bot de Telegram **no puede escribirle primero a un número de teléfono**: solo puede mandar
mensajes a un `chat_id` que ya le haya escrito al bot al menos una vez (`/start`). Para la
sustentación, lo más simple es: cada persona que vaya a hacer de "cliente" en la demo le escribe
`/start` al bot una sola vez antes, y en n8n guardas la relación teléfono↔chat_id (puede ser con
un nodo "Set" fijo si solo van a probar con 1-2 números, o con el "Data table" de n8n si quieres
algo más genérico). El workflow de ejemplo (`n8n-workflow-cotizacion.json`) trae un nodo de
Código con un mapa `TELEFONO_A_CHAT_ID` al inicio — edítalo con los chat_id reales antes de probar.

## 5. Importar los workflows

En n8n: menú (⋮) → **Import from File** → selecciona
`docs/contratos-reales/n8n-workflow-cotizacion.json` (y luego el de pago). Después:

1. Abre el nodo **Enviar Telegram** y asigna tus credenciales del bot (un token de @BotFather).
2. Abre el nodo **Código: mapear chat_id** y pon los teléfonos/chat_id reales.
3. Activa el workflow (switch "Active" arriba a la derecha) para que el webhook quede escuchando.
4. Copia la URL del nodo Webhook (botón "Test URL" o "Production URL") y ponla en `.env` como
   `N8N_WEBHOOK_COTIZACION`.

Si el import da un aviso de versión de nodo, n8n normalmente lo ajusta solo al abrir el nodo; si
no, reemplaza el nodo de Telegram/Webhook por uno nuevo arrastrado desde el panel y reconecta las
flechas — el resto del workflow (el JSON del webhook, la URL del callback) no cambia.
