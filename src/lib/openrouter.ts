import z from "zod";

export interface ProductoParaAnalisis {
  producto_id: string;
  nombre: string;
  sku: string;
  stock: number;
  precio_actual: number;      // precio en CLP, ya incluye IVA
  costo: number | null;
  fecha_vencimiento: string;  // "YYYY-MM-DD"
  dias_hasta_vencer: number;  // puede ser negativo si ya venció
  unidades_vendidas_30d: number;
}

export interface RecomendacionVencimiento {
  producto_id: string;
  urgencia: "alta" | "media" | "baja";
  estrategia: "descuento" | "bundle" | "donacion" | "devolucion_proveedor";
  descuento_sugerido_pct: number;    // 0-70
  precio_oferta_sugerido: number;    // precio_actual * (1 - pct/100), redondeado a CLP
  razon: string;                     // máx 2 oraciones
  mensaje_whatsapp: string;          // español chileno, máx 3 líneas
}

const RecomendacionVencimientoSchema = z.object({
  producto_id:            z.string().uuid(),
  urgencia:               z.enum(["alta", "media", "baja"]),
  estrategia:             z.enum(["descuento", "bundle", "donacion", "devolucion_proveedor"]),
  descuento_sugerido_pct: z.number().min(0).max(70),
  precio_oferta_sugerido: z.number().positive(),
  razon:                  z.string().max(500),
  mensaje_whatsapp:       z.string().max(300),
});

export async function analizarVencimientosConIA(
  apiKey: string,
  model: string,
  productos: ProductoParaAnalisis[],
  fechaHoy: string  // "YYYY-MM-DD"
): Promise<RecomendacionVencimiento[]> {
  // Construir el prompt del sistema
  const promptSistema = `Eres un experto en gestión de inventario para tiendas de mascotas en Chile.
Tu tarea es analizar productos próximos a vencer y recomendar acciones para minimizar pérdidas.

Reglas:
- Precios en pesos chilenos (CLP), sin decimales
- urgencia "alta": días_hasta_vencer < 7
- urgencia "media": días_hasta_vencer entre 7 y 14
- urgencia "baja": días_hasta_vencer >= 15
- descuento_sugerido_pct: entre 0 y 70 (nunca superar el 70%)
- precio_oferta_sugerido: redondear al entero más cercano
- mensaje_whatsapp: tono informal, máx 150 caracteres`;

  // Construir el mensaje del usuario
  const mensajeUsuario = `Fecha de hoy: ${fechaHoy}

Productos:
${JSON.stringify(productos, null, 2)}

Devuelve ÚNICAMENTE un array JSON válido con una entrada por producto. Sin texto adicional ni markdown.
Esquema de cada entrada:
{
  "producto_id": "string (uuid)",
  "urgencia": "alta" | "media" | "baja",
  "estrategia": "descuento" | "bundle" | "donacion" | "devolucion_proveedor",
  "descuento_sugerido_pct": number,
  "precio_oferta_sugerido": number,
  "razon": "string",
  "mensaje_whatsapp": "string"
}`;

  // Llamar a OpenRouter
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://petshop.ammatech.cl",
      "X-Title": "PetShop Optimizador Vencimientos",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: promptSistema },
        { role: "user", content: mensajeUsuario }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    }),
  });

  // Manejo de errores HTTP
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("API key inválida o sin créditos");
    }
    if (response.status === 429) {
      throw new Error("Límite de requests alcanzado, intenta más tarde");
    }
    if (response.status >= 500) {
      throw new Error("Error en OpenRouter, intenta más tarde");
    }
    throw new Error(`Error HTTP ${response.status}: ${response.statusText}`);
  }

  const responseData = await response.json();
  const content = responseData.choices[0]?.message?.content;

  if (!content) {
    throw new Error("El modelo devolvió una respuesta vacía");
  }

  // Limpiar posibles bloques de markdown y parsear JSON
  let cleanedContent = content.trim();
  if (cleanedContent.startsWith("```json")) {
    cleanedContent = cleanedContent.replace(/^```json/, "").replace(/```$/, "").trim();
  }
  if (cleanedContent.startsWith("```")) {
    cleanedContent = cleanedContent.replace(/^```/, "").replace(/```$/, "").trim();
  }

  let parsedData;
  try {
    parsedData = JSON.parse(cleanedContent);
  } catch {
    throw new Error("El modelo devolvió una respuesta no parseable");
  }

  // Extraer array si está envuelto en un objeto
  let recomendacionesArray: any[] = parsedData;
  if (Array.isArray(parsedData)) {
    recomendacionesArray = parsedData;
  } else if (parsedData.recomendaciones && Array.isArray(parsedData.recomendaciones)) {
    recomendacionesArray = parsedData.recomendaciones;
  } else {
    throw new Error("El modelo devolvió una estructura de respuesta inválida");
  }

  // Validar cada recomendación con Zod
  const recomendacionesValidas: RecomendacionVencimiento[] = [];
  
  for (const item of recomendacionesArray) {
    try {
      const validated = RecomendacionVencimientoSchema.parse(item);
      recomendacionesValidas.push(validated);
    } catch {
      // Descartar entradas inválidas sin romper el proceso
      console.warn("Recomendación inválida descartada:", item);
    }
  }

  return recomendacionesValidas;
}