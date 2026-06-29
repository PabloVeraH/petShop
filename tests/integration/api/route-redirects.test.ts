/**
 * Tests RD-01 a RD-14: Redirecciones de rutas españolas → inglesas
 * Verifica que next.config.ts exporta las redirecciones esperadas.
 */
import * as fs from "fs";
import * as path from "path";

const CONFIG_PATH = path.resolve(__dirname, "../../../next.config.ts");

interface RedirectEntry {
  source: string;
  destination: string;
  permanent: boolean;
}

function extractRedirects(): RedirectEntry[] {
  const src = fs.readFileSync(CONFIG_PATH, "utf-8");
  // Extraer el array entre el primer "async redirects()" y el "}," de cierre
  const match = src.match(/async redirects\(\)\s*\{[\s\S]*?return\s*\[([\s\S]*?)\];\s*\},/);
  if (!match) throw new Error("No se pudo extraer el array de redirects");

  const arrayContent = match[1];
  const redirects: RedirectEntry[] = [];

  // Procesar cada bloque { ... } individualmente
  const regex = /{([^}]+)}/g;
  let m;
  while ((m = regex.exec(arrayContent)) !== null) {
    const block = m[1];

    const sourceMatch = block.match(/source:\s*["']([^"']+)["']/);
    const destMatch = block.match(/destination:\s*["']([^"']+)["']/);
    const permMatch = block.match(/permanent:\s*(true|false)/);

    if (sourceMatch && destMatch) {
      redirects.push({
        source: sourceMatch[1],
        destination: destMatch[1],
        permanent: permMatch ? permMatch[1] === "true" : false,
      });
    }
  }

  return redirects;
}

describe("Redirects: rutas españolas → inglesas (RD-01 a RD-14)", () => {
  let redirects: RedirectEntry[];

  beforeAll(() => {
    redirects = extractRedirects();
  });

  const expectedRedirects: Record<string, { destination: string; permanent: boolean }> = {
    "/inventario":        { destination: "/inventory",         permanent: true },
    "/inventario/:path*": { destination: "/inventory/:path*",  permanent: true },
    "/clientes":          { destination: "/customers",         permanent: true },
    "/clientes/:path*":   { destination: "/customers/:path*",  permanent: true },
    "/ventas":            { destination: "/sales",             permanent: true },
    "/ventas/:path*":     { destination: "/sales/:path*",      permanent: true },
    "/proveedores":       { destination: "/suppliers",         permanent: true },
    "/proveedores/:path*":{ destination: "/suppliers/:path*",  permanent: true },
    "/compras":           { destination: "/purchases",         permanent: true },
    "/configuracion":     { destination: "/settings",          permanent: true },
    "/ajustes":           { destination: "/settings",          permanent: true },
    "/cuentas-pagar":     { destination: "/payables",          permanent: true },
    "/cuentas-por-pagar": { destination: "/payables",          permanent: true },
    "/reportes":          { destination: "/reports",           permanent: true },
  };

  for (const [source, expected] of Object.entries(expectedRedirects)) {
    it(`RD-${String(Object.keys(expectedRedirects).indexOf(source) + 1).padStart(2, "0")}: ${source} → ${expected.destination}`, () => {
      const entry = redirects.find((r) => r.source === source);
      expect(entry).toBeDefined();
      expect(entry!.destination).toBe(expected.destination);
      expect(entry!.permanent).toBe(expected.permanent);
    });
  }

  it("RD-15: reportes/prediccion NO tiene redirect (existe como ruta real)", () => {
    const entry = redirects.find((r) => r.source === "/reportes/prediccion");
    expect(entry).toBeUndefined();
  });

  it("RD-16: contiene el redirect previo /workers → /vendedores", () => {
    const entry = redirects.find((r) => r.source === "/workers");
    expect(entry).toBeDefined();
    expect(entry!.destination).toBe("/vendedores");
  });
});
