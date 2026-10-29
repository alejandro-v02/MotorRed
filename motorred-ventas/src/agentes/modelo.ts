import { RAG } from '../config.js';

interface ResultadoValidacion<T> {
  success: boolean;
  data?: T;
  error?: { message: string };
}
interface EsquemaZod<T> {
  safeParse: (v: unknown) => ResultadoValidacion<T>;
}

// Le pide al modelo de Ollama un JSON y lo valida contra un esquema zod (baranda "salida
// estructurada" del Concepto 3). Si no cumple el esquema, se le muestran los errores UNA vez; si
// vuelve a fallar, o no responde dentro del tiempo máximo, lanza para que el llamador use su plan B.
export async function pedirJSON<T>(args: {
  sistema: string;
  usuario: string;
  esquema: EsquemaZod<T>;
  tiempoMaximoMs?: number;
}): Promise<{ datos: T; modelo: string }> {
  const controlador = new AbortController();
  const limite = setTimeout(() => controlador.abort(), args.tiempoMaximoMs ?? 120_000);
  try {
    const pedir = async (mensajes: { role: string; content: string }[]) => {
      const r = await fetch(`${RAG.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: RAG.modeloChat, messages: mensajes, format: 'json', stream: false, options: { temperature: 0.1 } }),
        signal: controlador.signal,
      });
      if (!r.ok) throw new Error(`Ollama respondió ${r.status} (¿"ollama pull ${RAG.modeloChat}"?)`);
      const datos = (await r.json()) as { message?: { content?: string } };
      return datos.message?.content ?? '{}';
    };
    const mensajes = [
      { role: 'system', content: args.sistema },
      { role: 'user', content: args.usuario },
    ];
    let texto = await pedir(mensajes);
    let resultado = args.esquema.safeParse(JSON.parse(texto));
    if (!resultado.success) {
      mensajes.push({ role: 'assistant', content: texto });
      mensajes.push({ role: 'user', content: `Eso no cumple el esquema: ${resultado.error?.message}. Responde solo el JSON corregido, sin texto adicional.` });
      texto = await pedir(mensajes);
      resultado = args.esquema.safeParse(JSON.parse(texto));
    }
    if (!resultado.success || resultado.data === undefined) throw new Error(`El modelo no produjo un JSON válido: ${resultado.error?.message}`);
    return { datos: resultado.data, modelo: RAG.modeloChat };
  } finally {
    clearTimeout(limite);
  }
}
