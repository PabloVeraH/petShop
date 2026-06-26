/**
 * Tests I-07 a I-11: POST /api/clientes
 */
import { NextRequest } from "next/server";

const mockSingle = jest.fn();
const mockFrom = jest.fn();
const mockChain = {
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: mockSingle,
};
mockFrom.mockReturnValue(mockChain);

jest.mock("@/lib/auth", () => ({
  getStoreId: jest.fn().mockResolvedValue({
    userId: "user-1",
    storeId: "123e4567-e89b-12d3-a456-426614174000",
  }),
}));

jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom })),
}));

import { POST } from "@/app/api/clientes/route";

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/clientes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/clientes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(mockChain);
    mockChain.select.mockReturnThis();
    mockChain.insert.mockReturnThis();
    mockChain.eq.mockReturnThis();
  });

  // I-07
  it("I-07: rechaza RUT inválido con 400", async () => {
    const res = await POST(makeRequest({ rut: "12.345.678-9", nombre: "Juan Pérez" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/rut inválido/i);
  });

  // I-08
  it("I-08: rechaza nombre menor a 3 caracteres con 400", async () => {
    const res = await POST(makeRequest({ rut: "11.111.111-1", nombre: "Ju" }));
    expect(res.status).toBe(400);
  });

  // I-09
  it("I-09: retorna 409 si RUT ya existe (duplicate key)", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: "23505" } });
    const res = await POST(makeRequest({ rut: "11.111.111-1", nombre: "Juan Pérez" }));
    expect(res.status).toBe(409);
  });

  // I-10
  it("I-10: crea cliente con datos válidos y retorna 201", async () => {
    const cliente = {
      id: "123e4567-e89b-12d3-a456-426614174001",
      rut: "11111111-1",
      nombre: "Juan Pérez",
    };
    mockSingle.mockResolvedValue({ data: cliente, error: null });
    const res = await POST(makeRequest({ rut: "11.111.111-1", nombre: "Juan Pérez" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.nombre).toBe("Juan Pérez");
  });

  // I-11
  it("I-11: creación válida también llama from('fidelizacion')", async () => {
    const cliente = {
      id: "123e4567-e89b-12d3-a456-426614174001",
      rut: "11111111-1",
      nombre: "Juan Pérez",
    };
    mockSingle.mockResolvedValue({ data: cliente, error: null });
    await POST(makeRequest({ rut: "11.111.111-1", nombre: "Juan Pérez" }));
    const tablas = mockFrom.mock.calls.map(([t]: [string]) => t);
    expect(tablas).toContain("fidelizacion");
  });

  // I-12 — REGRESIÓN: el email es ahora validado con Zod; evita guardar direcciones
  // malformadas que podrían resultar de errores de tipeo (ej: "esteban@" sin dominio).
  it("I-12: REGRESIÓN — rechaza email con formato inválido con 400", async () => {
    const res = await POST(
      makeRequest({ rut: "11.111.111-1", nombre: "Juan Pérez", email: "no-es-un-email" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/correo electrónico inválido/i);
  });

  // I-13: email vacío se trata como null — no genera error de validación
  it("I-13: email vacío ('') se almacena como null, no rechaza la solicitud", async () => {
    const cliente = {
      id: "123e4567-e89b-12d3-a456-426614174001",
      rut: "11111111-1",
      nombre: "Juan Pérez",
      email: null,
    };
    mockSingle.mockResolvedValue({ data: cliente, error: null });
    const res = await POST(
      makeRequest({ rut: "11.111.111-1", nombre: "Juan Pérez", email: "" })
    );
    expect(res.status).toBe(201);
    // El INSERT debe recibir email: null, nunca la cadena vacía ""
    const insertArg = mockChain.insert.mock.calls[0][0];
    expect(insertArg.email).toBeNull();
  });

  // I-14: email válido se almacena tal cual
  it("I-14: email válido se guarda correctamente en el INSERT", async () => {
    const cliente = {
      id: "123e4567-e89b-12d3-a456-426614174001",
      rut: "11111111-1",
      nombre: "Juan Pérez",
      email: "juan@ejemplo.cl",
    };
    mockSingle.mockResolvedValue({ data: cliente, error: null });
    const res = await POST(
      makeRequest({ rut: "11.111.111-1", nombre: "Juan Pérez", email: "juan@ejemplo.cl" })
    );
    expect(res.status).toBe(201);
    const insertArg = mockChain.insert.mock.calls[0][0];
    expect(insertArg.email).toBe("juan@ejemplo.cl");
  });
});
