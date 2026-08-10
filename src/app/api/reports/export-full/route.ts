import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { predictDemand } from "@/lib/analytics/demand-forecasting";
import { getReorderSuggestions } from "@/lib/analytics/reorder-suggestions";
import { generateFullReportExcel } from "@/lib/reports/excel-generator";
import {
  generatePrediccionPDF,
  generateReorderPDF,
  PrediccionReportData,
  ReorderReportData,
} from "@/lib/reports/pdf-generator";
import { createServiceClient } from "@/lib/supabase";
import { z } from "zod";
import * as XLSX from "xlsx";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";

const QuerySchema = z.object({
  formato: z.enum(["pdf", "excel"]).default("pdf"),
  producto_id: z.string().uuid().optional(),
  seccion: z.enum(["prediccion", "reorden", "full"]).default("full"),
});

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = QuerySchema.safeParse({
    formato: req.nextUrl.searchParams.get("formato") ?? "pdf",
    producto_id: req.nextUrl.searchParams.get("producto_id") ?? undefined,
    seccion: req.nextUrl.searchParams.get("seccion") ?? "full",
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { formato, producto_id, seccion } = parsed.data;
  const supabase = createServiceClient();

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: ctx.storeId,
    userId: ctx.userId,
    action: "EXPORT",
    entityType: "report_export_full",
    changeDescription: `Exportación completa ${seccion} en formato ${formato}`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  if (formato === "excel") {
    let prediccion: PrediccionReportData | null = null;
    let reorderData: ReorderReportData[] = [];

    if (seccion === "prediccion" || seccion === "full") {
      if (!producto_id) {
        return NextResponse.json({ error: "producto_id requerido para prediccion" }, { status: 400 });
      }
      const { data: producto } = await supabase
        .from("productos")
        .select("id, nombre, sku")
        .eq("id", producto_id)
        .single();

      if (producto) {
        const result = await predictDemand(producto_id, ctx.storeId, 30);
        prediccion = {
          producto_nombre: producto.nombre,
          sku: producto.sku,
          tendencia: result.tendencia,
          confianza: result.confianza,
          prediccion: result.prediccion,
          estacionalidad: result.estacionalidad,
        };
      }
    }

    if (seccion === "reorden" || seccion === "full") {
      const sugerencias = await getReorderSuggestions(ctx.storeId);
      reorderData = sugerencias.map(s => ({
        producto_nombre: s.producto_nombre,
        sku: s.sku,
        stock_actual: s.stock_actual,
        stock_minimo: s.stock_minimo,
        demanda_promedio: s.demanda_promedio,
        cantidad_sugerida: s.cantidad_sugerida,
        urgencia: s.urgencia,
        proveedor_nombre: s.proveedor.nombre,
        tiempo_entrega: s.proveedor.tiempo_entrega,
        razon: s.razon,
      }));
    }

    const wb = generateFullReportExcel(prediccion, reorderData);
    const buf = Buffer.from(
      XLSX.write(wb, { bookType: "xlsx", type: "buffer" }),
      "binary"
    );

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="reporte_${seccion}.xlsx"`,
      },
    });
  }

  if (seccion === "prediccion") {
    if (!producto_id) {
      return NextResponse.json({ error: "producto_id requerido para prediccion" }, { status: 400 });
    }

    const { data: producto } = await supabase
      .from("productos")
      .select("id, nombre, sku")
      .eq("id", producto_id)
      .single();

    if (!producto) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }

    const result = await predictDemand(producto_id, ctx.storeId, 30);
    const data: PrediccionReportData = {
      producto_nombre: producto.nombre,
      sku: producto.sku,
      tendencia: result.tendencia,
      confianza: result.confianza,
      prediccion: result.prediccion,
      estacionalidad: result.estacionalidad,
    };

    const doc = generatePrediccionPDF(data);
    const buf = doc.output("arraybuffer");

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="prediccion_${producto.sku}.pdf"`,
      },
    });
  }

  if (seccion === "reorden" || seccion === "full") {
    const sugerencias = await getReorderSuggestions(ctx.storeId);
    const reorderData: ReorderReportData[] = sugerencias.map(s => ({
      producto_nombre: s.producto_nombre,
      sku: s.sku,
      stock_actual: s.stock_actual,
      stock_minimo: s.stock_minimo,
      demanda_promedio: s.demanda_promedio,
      cantidad_sugerida: s.cantidad_sugerida,
      urgencia: s.urgencia,
      proveedor_nombre: s.proveedor.nombre,
      tiempo_entrega: s.proveedor.tiempo_entrega,
      razon: s.razon,
    }));

    const doc = generateReorderPDF(reorderData);
    const buf = doc.output("arraybuffer");

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="reorden_${seccion}.pdf"`,
      },
    });
  }

  return NextResponse.json({ error: "Seccion invalida" }, { status: 400 });
}, { endpoint: "GET /api/reports/export-full" });