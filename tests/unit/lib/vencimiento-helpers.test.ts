/**
 * Helper functions para manejo de vencimientos
 */

interface VencimientoStatus {
  status: "vencido" | "proximo" | "vigente";
  label: string;
  color: string;
  diasRestantes: number;
}

export function getVencimientoStatus(
  fechaVencimiento: string | null,
  diasAlerta: number = 7
): VencimientoStatus {
  if (!fechaVencimiento) {
    return {
      status: "vigente",
      label: "Vigente",
      color: "gray",
      diasRestantes: Infinity,
    };
  }

  const hoy = new Date().toISOString().split("T")[0];
  const diasRestantes = Math.ceil(
    (new Date(fechaVencimiento).getTime() - new Date(hoy).getTime()) / 86400000
  );

  if (diasRestantes < 0) {
    return {
      status: "vencido",
      label: "Vencido",
      color: "red",
      diasRestantes: diasRestantes,
    };
  }

  if (diasRestantes <= diasAlerta) {
    return {
      status: "proximo",
      label: `Vence en ${diasRestantes}d`,
      color: "amber",
      diasRestantes: diasRestantes,
    };
  }

  return {
    status: "vigente",
    label: "Vigente",
    color: "gray",
    diasRestantes: diasRestantes,
  };
}

export function clasificarProductos(
  productos: Array<{
    id: string;
    fecha_vencimiento: string | null;
    dias_alerta_expira: number;
    stock: number;
  }>
) {
  const hoy = new Date().toISOString().split("T")[0];

  const vencidos = productos.filter((p) => {
    if (!p.fecha_vencimiento || p.stock === 0) return false;
    return p.fecha_vencimiento < hoy;
  });

  const proximos = productos.filter((p) => {
    if (!p.fecha_vencimiento || p.stock === 0) return false;
    if (p.fecha_vencimiento < hoy) return false;

    const diasRestantes = Math.ceil(
      (new Date(p.fecha_vencimiento).getTime() - new Date(hoy).getTime()) / 86400000
    );
    return diasRestantes <= p.dias_alerta_expira;
  });

  return { vencidos, proximos };
}

export function diasRestantes(fechaVencimiento: string): number {
  const hoy = new Date().toISOString().split("T")[0];
  return Math.ceil(
    (new Date(fechaVencimiento).getTime() - new Date(hoy).getTime()) / 86400000
  );
}

// Test file
describe("lib/vencimiento-helpers", () => {
  beforeEach(() => {
    // Mock de la fecha actual como 2024-04-16
    jest.spyOn(Date.prototype, "toISOString").mockReturnValue("2024-04-16T00:00:00.000Z");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getVencimientoStatus", () => {
    it("debería retornar status 'vigente' si no hay fecha de vencimiento", () => {
      const result = getVencimientoStatus(null);

      expect(result.status).toBe("vigente");
      expect(result.label).toBe("Vigente");
      expect(result.color).toBe("gray");
      expect(result.diasRestantes).toBe(Infinity);
    });

    it("debería retornar status 'vencido' si la fecha es anterior a hoy", () => {
      const result = getVencimientoStatus("2024-04-10");

      expect(result.status).toBe("vencido");
      expect(result.label).toBe("Vencido");
      expect(result.color).toBe("red");
      expect(result.diasRestantes).toBeLessThan(0);
    });

    it("debería retornar status 'proximo' si está dentro de dias_alerta_expira", () => {
      const result = getVencimientoStatus("2024-04-20", 7);

      expect(result.status).toBe("proximo");
      expect(result.label).toContain("Vence en");
      expect(result.color).toBe("amber");
      expect(result.diasRestantes).toBe(4);
    });

    it("debería retornar status 'vigente' si está fuera de dias_alerta_expira", () => {
      const result = getVencimientoStatus("2024-05-01", 7);

      expect(result.status).toBe("vigente");
      expect(result.label).toBe("Vigente");
      expect(result.color).toBe("gray");
      expect(result.diasRestantes).toBe(15);
    });

    it("debería calcular correctamente dias_alerta_expira=0", () => {
      const result = getVencimientoStatus("2024-04-17", 0);

      expect(result.status).toBe("vigente"); // 1 día > 0
      expect(result.diasRestantes).toBe(1);
    });

    it("debería incluir dias_restantes en label para próximos", () => {
      const result = getVencimientoStatus("2024-04-18", 7);

      expect(result.label).toContain("2d");
      expect(result.diasRestantes).toBe(2);
    });

    it("debería usar dias_alerta_expira por defecto si no se especifica", () => {
      const result = getVencimientoStatus("2024-04-20");

      expect(result.status).toBe("proximo"); // 4 días <= 7 (default)
    });

    it("debería manejar fecha de vencimiento hoy", () => {
      const result = getVencimientoStatus("2024-04-16", 7);

      expect(result.status).toBe("proximo");
      expect(result.diasRestantes).toBe(0);
    });
  });

  describe("clasificarProductos", () => {
    it("debería clasificar productos vencidos correctamente", () => {
      const productos = [
        {
          id: "p1",
          fecha_vencimiento: "2024-04-10",
          dias_alerta_expira: 7,
          stock: 5,
        },
        {
          id: "p2",
          fecha_vencimiento: "2024-04-20",
          dias_alerta_expira: 7,
          stock: 3,
        },
      ];

      const { vencidos, proximos } = clasificarProductos(productos);

      expect(vencidos).toHaveLength(1);
      expect(vencidos[0].id).toBe("p1");
      expect(proximos).toHaveLength(1);
      expect(proximos[0].id).toBe("p2");
    });

    it("debería excluir productos sin fecha de vencimiento", () => {
      const productos = [
        {
          id: "p1",
          fecha_vencimiento: null,
          dias_alerta_expira: 7,
          stock: 5,
        },
        {
          id: "p2",
          fecha_vencimiento: "2024-04-10",
          dias_alerta_expira: 7,
          stock: 3,
        },
      ];

      const { vencidos, proximos } = clasificarProductos(productos);

      expect(vencidos).toHaveLength(1);
      expect(proximos).toHaveLength(0);
    });

    it("debería excluir productos con stock 0", () => {
      const productos = [
        {
          id: "p1",
          fecha_vencimiento: "2024-04-10",
          dias_alerta_expira: 7,
          stock: 0,
        },
      ];

      const { vencidos } = clasificarProductos(productos);

      expect(vencidos).toHaveLength(0);
    });

    it("debería respetar dias_alerta_expira personalizado", () => {
      const productos = [
        {
          id: "p1",
          fecha_vencimiento: "2024-04-25",
          dias_alerta_expira: 3, // Solo alertar si <= 3 días
          stock: 5,
        },
      ];

      const { proximos } = clasificarProductos(productos);

      expect(proximos).toHaveLength(0); // 9 días > 3
    });

    it("debería retornar arrays vacíos si no hay vencimientos", () => {
      const productos = [
        {
          id: "p1",
          fecha_vencimiento: "2025-12-31",
          dias_alerta_expira: 7,
          stock: 10,
        },
      ];

      const { vencidos, proximos } = clasificarProductos(productos);

      expect(vencidos).toHaveLength(0);
      expect(proximos).toHaveLength(0);
    });

    it("debería clasificar múltiples vencidos y próximos correctamente", () => {
      const productos = [
        {
          id: "p1",
          fecha_vencimiento: "2024-04-10",
          dias_alerta_expira: 7,
          stock: 2,
        },
        {
          id: "p2",
          fecha_vencimiento: "2024-04-12",
          dias_alerta_expira: 7,
          stock: 3,
        },
        {
          id: "p3",
          fecha_vencimiento: "2024-04-18",
          dias_alerta_expira: 7,
          stock: 4,
        },
        {
          id: "p4",
          fecha_vencimiento: "2024-04-25",
          dias_alerta_expira: 7,
          stock: 5,
        },
      ];

      const { vencidos, proximos } = clasificarProductos(productos);

      expect(vencidos).toHaveLength(2); // p1, p2
      expect(proximos).toHaveLength(1); // p3
    });
  });

  describe("diasRestantes", () => {
    it("debería calcular dias restantes correctamente", () => {
      const result = diasRestantes("2024-04-20");

      expect(result).toBe(4);
    });

    it("debería retornar 0 si es hoy", () => {
      const result = diasRestantes("2024-04-16");

      expect(result).toBe(0);
    });

    it("debería retornar valor negativo si está vencido", () => {
      const result = diasRestantes("2024-04-10");

      expect(result).toBeLessThan(0);
    });

    it("debería calcular correctamente días en el futuro", () => {
      const result = diasRestantes("2024-05-16");

      expect(result).toBe(30);
    });

    it("debería manejar fechas con timestamps", () => {
      const result = diasRestantes("2024-04-23");

      expect(result).toBe(7);
    });
  });

  describe("Edge cases y errores", () => {
    it("debería manejar fecha vencimiento null sin errores", () => {
      expect(() => getVencimientoStatus(null)).not.toThrow();
    });

    it("debería manejar array vacío en clasificarProductos", () => {
      const { vencidos, proximos } = clasificarProductos([]);

      expect(vencidos).toEqual([]);
      expect(proximos).toEqual([]);
    });

    it("debería manejar dias_alerta_expira negativo", () => {
      const result = getVencimientoStatus("2024-04-20", -5);

      // Con dias_alerta_expira negativo, todos estarán fuera de rango
      expect(result.status).toBe("vigente");
    });

    it("debería manejar dias_alerta_expira muy grande", () => {
      const result = getVencimientoStatus("2024-04-20", 1000);

      expect(result.status).toBe("proximo");
      expect(result.diasRestantes).toBe(4);
    });

    it("debería calcular correctamente a través de mes", () => {
      const result = diasRestantes("2024-05-05");

      expect(result).toBe(19);
    });

    it("debería calcular correctamente a través de año", () => {
      // Nota: el test usa 2024-04-16 como "hoy"
      // Una fecha real sería 2025-01-15
      // Por ahora solo testamos dentro del mismo mes/año
      const result = diasRestantes("2025-04-16");

      expect(result).toBeGreaterThan(300);
    });
  });

  describe("Integración con componentes", () => {
    it("debería permitir usar getVencimientoStatus en templates", () => {
      const status = getVencimientoStatus("2024-04-20", 7);

      const badges = {
        red: status.status === "vencido",
        amber: status.status === "proximo",
        gray: status.status === "vigente",
      };

      expect(badges[status.color as keyof typeof badges]).toBe(true);
    });

    it("debería permitir usar clasificarProductos para filtrado", () => {
      const todos = [
        {
          id: "p1",
          fecha_vencimiento: "2024-04-10",
          dias_alerta_expira: 7,
          stock: 5,
        },
        {
          id: "p2",
          fecha_vencimiento: "2024-04-20",
          dias_alerta_expira: 7,
          stock: 3,
        },
      ];

      const { vencidos } = clasificarProductos(todos);
      const productosNoVencidos = todos.filter((p) => !vencidos.find((v) => v.id === p.id));

      expect(productosNoVencidos).toHaveLength(1);
      expect(productosNoVencidos[0].id).toBe("p2");
    });
  });
});
