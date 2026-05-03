import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { parseProductosXLSX, generateTemplateXLSX } from "@/lib/excel/parser";
import { ProductoImportRowSchema } from "@/lib/validation";

const MAX_ROWS = 500;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface ImportError {
  fila: number;
  nombre: string;
  motivo: string;
}

export interface ImportResult {
  creados: number;
  omitidos: number;
  errores: ImportError[];
  categoriasCreadas: string[];
}

// GET /api/inventario/import — descarga el template
export async function GET() {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const buffer = generateTemplateXLSX();
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-productos.xlsx"',
    },
  });
}

// POST /api/inventario/import — importa productos desde .xlsx
export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id, userId } = ctx;

  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);
  try {
    requireStoreAdmin(admin);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "true";

  // Leer archivo del FormData
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Se requiere un archivo .xlsx" }, { status: 400 });
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "El archivo supera el límite de 5 MB" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext !== "xlsx") {
    return NextResponse.json({ error: "Solo se aceptan archivos .xlsx" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const rawRows = parseProductosXLSX(buffer);

  if (rawRows.length === 0) {
    return NextResponse.json({ error: "El archivo no contiene filas con datos" }, { status: 400 });
  }

  if (rawRows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `El archivo supera el límite de ${MAX_ROWS} filas (tiene ${rawRows.length})` },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const errores: ImportError[] = [];
  const validRows: Array<ReturnType<typeof ProductoImportRowSchema.parse> & { _fila: number }> = [];

  // 1. Validar cada fila con Zod
  for (const raw of rawRows) {
    const precioRaw = raw.precio != null && raw.precio !== "" ? Number(raw.precio) : undefined;
    const parsed = ProductoImportRowSchema.safeParse({
      sku: raw.sku != null ? String(raw.sku).trim() : "",
      nombre: raw.nombre != null ? String(raw.nombre).trim() : "",
      ...(precioRaw !== undefined ? { precio: precioRaw } : {}),
      costo: raw.costo != null ? Number(raw.costo) : undefined,
      stock: raw.stock != null ? Number(raw.stock) : 0,
      stock_minimo: raw.stock_minimo != null ? Number(raw.stock_minimo) : 5,
      marca: raw.marca,
      peso_gramos: raw.peso_gramos != null ? Number(raw.peso_gramos) : undefined,
      codigo_barra: raw.codigo_barra,
      categoria: raw.categoria,
      fecha_vencimiento: raw.fecha_vencimiento || null,
    });

    if (!parsed.success) {
      errores.push({
        fila: raw._fila,
        nombre: String(raw.nombre ?? ""),
        motivo: parsed.error.issues.map((i) => i.message).join("; "),
      });
    } else {
      validRows.push({ ...parsed.data, _fila: raw._fila });
    }
  }

  // 2. Detectar SKUs duplicados dentro del propio archivo
  const skusEnArchivo = new Map<string, number>();
  for (const row of validRows) {
    const skuKey = row.sku.toLowerCase();
    if (skusEnArchivo.has(skuKey)) {
      errores.push({
        fila: row._fila,
        nombre: row.nombre,
        motivo: `SKU '${row.sku}' está duplicado en el archivo (primera aparición: fila ${skusEnArchivo.get(skuKey)})`,
      });
    } else {
      skusEnArchivo.set(skuKey, row._fila);
    }
  }
  const filasDuplicadasEnArchivo = new Set(
    errores.filter((e) => e.motivo.includes("duplicado en el archivo")).map((e) => e.fila)
  );
  const rowsSinDuplicadosInternos = validRows.filter((r) => !filasDuplicadasEnArchivo.has(r._fila));

  // 3. Verificar duplicados contra la BD (SKU y código de barra)
  const skusAVerificar = rowsSinDuplicadosInternos.map((r) => r.sku);
  const codigosAVerificar = rowsSinDuplicadosInternos
    .filter((r) => r.codigo_barra)
    .map((r) => r.codigo_barra!);

  let skusExistentes: Set<string> = new Set();
  let codigosExistentes: Set<string> = new Set();

  if (skusAVerificar.length > 0) {
    const { data: existentes } = await supabase
      .from("productos")
      .select("sku, codigo_barra")
      .eq("store_id", store_id)
      .in("sku", skusAVerificar);
    skusExistentes = new Set((existentes ?? []).map((p) => p.sku.toLowerCase()));
  }

  if (codigosAVerificar.length > 0) {
    const { data: existentesCB } = await supabase
      .from("productos")
      .select("codigo_barra")
      .eq("store_id", store_id)
      .in("codigo_barra", codigosAVerificar);
    codigosExistentes = new Set(
      (existentesCB ?? []).filter((p) => p.codigo_barra).map((p) => p.codigo_barra!.toLowerCase())
    );
  }

  const filasConErrorDB = new Set<number>();
  for (const row of rowsSinDuplicadosInternos) {
    if (skusExistentes.has(row.sku.toLowerCase())) {
      errores.push({ fila: row._fila, nombre: row.nombre, motivo: `SKU '${row.sku}' ya existe en el inventario` });
      filasConErrorDB.add(row._fila);
    } else if (row.codigo_barra && codigosExistentes.has(row.codigo_barra.toLowerCase())) {
      errores.push({ fila: row._fila, nombre: row.nombre, motivo: `Código de barra '${row.codigo_barra}' ya existe en el inventario` });
      filasConErrorDB.add(row._fila);
    }
  }

  const rowsAInsertar = rowsSinDuplicadosInternos.filter((r) => !filasConErrorDB.has(r._fila));
  const omitidos = errores.filter(
    (e) => e.motivo.includes("ya existe") || e.motivo.includes("duplicado en el archivo")
  ).length;

  if (dryRun || rowsAInsertar.length === 0) {
    return NextResponse.json({
      creados: dryRun ? rowsAInsertar.length : 0,
      omitidos,
      errores,
      categoriasCreadas: [],
      dryRun,
    } satisfies ImportResult & { dryRun: boolean });
  }

  // 4. Resolver categorías (buscar o crear)
  const categoriasCreadas: string[] = [];
  const categoriaMap = new Map<string, string>(); // nombre → id

  const nombresCategorias = [...new Set(rowsAInsertar.filter((r) => r.categoria).map((r) => r.categoria!))];
  if (nombresCategorias.length > 0) {
    const { data: categoriasDB } = await supabase
      .from("categorias")
      .select("id, nombre")
      .eq("store_id", store_id)
      .in("nombre", nombresCategorias);

    for (const cat of categoriasDB ?? []) {
      categoriaMap.set(cat.nombre.toLowerCase(), cat.id);
    }

    const faltantes = nombresCategorias.filter((n) => !categoriaMap.has(n.toLowerCase()));
    for (const nombre of faltantes) {
      const { data: nueva } = await supabase
        .from("categorias")
        .insert({ store_id, nombre, es_alimento: false, activo: true })
        .select("id")
        .single();
      if (nueva) {
        categoriaMap.set(nombre.toLowerCase(), nueva.id);
        categoriasCreadas.push(nombre);
      }
    }
  }

  // 5. Insertar productos
  const inserts = rowsAInsertar.map((row) => ({
    store_id,
    sku: row.sku,
    nombre: row.nombre,
    precio: row.precio,
    costo: row.costo ?? null,
    stock: row.stock,
    stock_minimo: row.stock_minimo,
    marca: row.marca ?? null,
    peso_gramos: row.peso_gramos ?? null,
    codigo_barra: row.codigo_barra ?? null,
    categoria_id: row.categoria ? (categoriaMap.get(row.categoria.toLowerCase()) ?? null) : null,
    fecha_vencimiento: row.fecha_vencimiento ?? null,
    activo: true,
  }));

  const { error: insertError } = await supabase.from("productos").insert(inserts);
  if (insertError) {
    return NextResponse.json({ error: "Error al insertar productos" }, { status: 500 });
  }

  const result: ImportResult = {
    creados: rowsAInsertar.length,
    omitidos,
    errores,
    categoriasCreadas,
  };

  const meta = await getRequestMetadata(req);
  await logAudit({
    storeId: store_id,
    userId: userId || "unknown",
    action: "CREATE",
    entityType: "bulk_import",
    changeDescription: `Importación masiva: ${result.creados} creados, ${result.omitidos} omitidos, ${result.errores.length} errores`,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    result: "success",
  });

  return NextResponse.json(result);
}
