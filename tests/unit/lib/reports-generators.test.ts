import {
  generatePrediccionExcel,
  generateReorderExcel,
  generateFullReportExcel,
} from "@/lib/reports/excel-generator";
import {
  generatePrediccionPDF,
  generateReorderPDF,
} from "@/lib/reports/pdf-generator";

describe("excel-generator", () => {
  describe("generatePrediccionExcel", () => {
    it("genera workbook con 2 hojas", () => {
      const data = {
        producto_nombre: "Test Product",
        sku: "SKU001",
        tendencia: "alta",
        confianza: 0.85,
        prediccion: [10, 15, 20, 25],
        estacionalidad: ["lunes: 15", "martes: 20"],
      };

      const wb = generatePrediccionExcel(data);

      expect(wb.SheetNames).toContain("Resumen");
      expect(wb.SheetNames).toContain("Proyeccion");
    });

    it("incluye datos del producto en resumen", () => {
      const data = {
        producto_nombre: "Test Product",
        sku: "SKU001",
        tendencia: "estable",
        confianza: 0.75,
        prediccion: [10, 10, 10],
        estacionalidad: [],
      };

      const wb = generatePrediccionExcel(data);
      const resumenSheet = wb.Sheets["Resumen"];

      expect(resumenSheet).toBeDefined();
    });
  });

  describe("generateReorderExcel", () => {
    it("genera workbook con hojas de datos y resumen", () => {
      const sugerencias = [
        {
          producto_nombre: "Product A",
          sku: "SKU001",
          stock_actual: 50,
          stock_minimo: 20,
          demanda_promedio: 5,
          cantidad_sugerida: 100,
          urgencia: "alta",
          proveedor_nombre: "Supplier X",
          tiempo_entrega: 7,
          razon: "Stock bajo",
        },
      ];

      const wb = generateReorderExcel(sugerencias);

      expect(wb.SheetNames).toContain("Reorden");
      expect(wb.SheetNames).toContain("Resumen Reorden");
    });
  });

  describe("generateFullReportExcel", () => {
    it("genera workbook combinando prediccion y reorden", () => {
      const prediccion = {
        producto_nombre: "Test",
        sku: "SKU001",
        tendencia: "alta",
        confianza: 0.8,
        prediccion: [10, 20],
        estacionalidad: [],
      };

      const reorder = [
        {
          producto_nombre: "Test",
          sku: "SKU001",
          stock_actual: 50,
          stock_minimo: 20,
          demanda_promedio: 5,
          cantidad_sugerida: 100,
          urgencia: "alta",
          proveedor_nombre: "Supplier X",
          tiempo_entrega: 7,
          razon: "Stock bajo",
        },
      ];

      const wb = generateFullReportExcel(prediccion, reorder);

      expect(wb.SheetNames).toContain("Resumen");
      expect(wb.SheetNames).toContain("Proyeccion");
      expect(wb.SheetNames).toContain("Reorden");
    });

    it("maneja null prediccion", () => {
      const reorder = [
        {
          producto_nombre: "Test",
          sku: "SKU001",
          stock_actual: 50,
          stock_minimo: 20,
          demanda_promedio: 5,
          cantidad_sugerida: 100,
          urgencia: "alta",
          proveedor_nombre: "Supplier X",
          tiempo_entrega: 7,
          razon: "Stock bajo",
        },
      ];

      const wb = generateFullReportExcel(null, reorder);

      expect(wb.SheetNames).toContain("Reorden");
      expect(wb.SheetNames).toContain("Resumen Reorden");
    });
  });
});

describe("pdf-generator", () => {
  describe("generatePrediccionPDF", () => {
    it("genera un PDF valido", () => {
      const data = {
        producto_nombre: "Test Product",
        sku: "SKU001",
        tendencia: "alta",
        confianza: 0.85,
        prediccion: [10, 15, 20, 25, 30],
        estacionalidad: ["lunes: 15"],
      };

      const doc = generatePrediccionPDF(data);

      expect(doc).toBeDefined();
      expect(typeof doc.output).toBe("function");
    });
  });

  describe("generateReorderPDF", () => {
    it("genera un PDF con lista de sugerencias", () => {
      const sugerencias = [
        {
          producto_nombre: "Product A",
          sku: "SKU001",
          stock_actual: 50,
          stock_minimo: 20,
          demanda_promedio: 5,
          cantidad_sugerida: 100,
          urgencia: "alta",
          proveedor_nombre: "Supplier X",
          tiempo_entrega: 7,
          razon: "Stock bajo",
        },
        {
          producto_nombre: "Product B",
          sku: "SKU002",
          stock_actual: 10,
          stock_minimo: 30,
          demanda_promedio: 8,
          cantidad_sugerida: 200,
          urgencia: "critica",
          proveedor_nombre: "Supplier Y",
          tiempo_entrega: 5,
          razon: "Stock critico",
        },
      ];

      const doc = generateReorderPDF(sugerencias);

      expect(doc).toBeDefined();
      expect(typeof doc.output).toBe("function");
    });
  });
});