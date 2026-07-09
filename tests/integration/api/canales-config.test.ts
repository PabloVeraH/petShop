/**
 * Integration tests for GET/POST/PATCH /api/canales/config
 * I-200 — POST sin activo → defaults to false (no activa sin credenciales)
 * I-201 — POST con activo=false → guarda como false
 * I-202 — POST con activo=true con credenciales → guarda como true
 * I-203 — PATCH sin activo no modifica activo existente
 * I-204 — PATCH con activo=false → desactiva canal correctamente
 * I-205 — GET retorna activo correcto desde DB
 * I-206 — POST activo=true sin credenciales → 422
 * I-207 — PATCH activo=true sin credenciales previas → 422
 * I-208 — PATCH activo=true sin credenciales en body pero con credenciales previas en DB → ok
 */

import { GET, POST, PATCH } from "@/app/api/canales/config/route";
import { NextRequest } from "next/server";
import crypto from "crypto";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");
jest.mock("@/lib/canales/encryption");

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const CONFIG_ID = "123e4567-e89b-12d3-a456-426614174999";

// Set encryption key for encryptJSON
process.env.ENCRYPTION_KEY = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";

jest.mock("@/lib/canales/encryption", () => ({
  encryptJSON: jest.fn(() => ({
    ciphertext: "encrypted",
    iv: "iv123",
    authTag: "tag123",
  })),
  decryptJSON: jest.fn(),
}));

function authReq(method: string, body?: object, storeId = STORE_ID) {
  if (method === "GET") {
    return new NextRequest("http://localhost/api/canales/config");
  }
  return new NextRequest("http://localhost/api/canales/config", {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

let mockSelect: jest.Mock;
let mockInsert: jest.Mock;
let mockUpdate: jest.Mock;
let mockFrom: jest.Mock;
let mockEq: jest.Mock;
let mockSingle: jest.Mock;

function buildChain() {
  mockSelect = jest.fn();
  mockInsert = jest.fn();
  mockUpdate = jest.fn();
  mockEq = jest.fn();
  mockSingle = jest.fn();

  const chain: Record<string, jest.Mock> = {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    eq: mockEq,
    single: mockSingle,
  };

  Object.values(chain).forEach((fn) => fn.mockReturnValue(chain));

  // Hacer .select().eq().eq().single() retornar promesas
  (chain as any).then = function (resolve: any) {
    return resolve({ data: null, error: null });
  };

  return chain;
}

describe("POST /api/canales/config — activo handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: STORE_ID, userId: "u1" });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => buildChain()),
    });
  });

  function makeResp(data: unknown) {
    mockEq.mockReturnThis();
    mockSelect.mockReturnThis();
    mockInsert.mockReturnThis();
    mockSingle.mockImplementation(() => Promise.resolve({ data, error: null }));
    (buildChain as any).then = function (resolve: any) {
      return resolve({ data, error: null });
    };
  }

  // I-201
  it("I-201: POST sin activo → defaults a false (no activa sin credenciales)", async () => {
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => {
        const c = buildChain();
        c.select.mockReturnValue(c);
        c.insert.mockReturnValue(c);
        c.eq.mockReturnValue(c);
        mockSingle.mockResolvedValue({
          data: { id: CONFIG_ID, canal_id: "rappi", activo: false },
          error: null,
        });
        (c as any).then = (resolve: any) =>
          resolve({ data: { id: CONFIG_ID, canal_id: "rappi", activo: false }, error: null });
        return c;
      }),
    });

    const res = await POST(authReq("POST", { canal_id: "rappi", credenciales: {} }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.activo).toBe(false);
  });

  // I-202
  it("I-202: POST con activo=false → guarda como false", async () => {
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => {
        const c = buildChain();
        c.select.mockReturnValue(c);
        c.insert.mockReturnValue(c);
        c.eq.mockReturnValue(c);
        mockSingle.mockResolvedValue({
          data: { id: CONFIG_ID, canal_id: "rappi", activo: false },
          error: null,
        });
        (c as any).then = (resolve: any) =>
          resolve({ data: { id: CONFIG_ID, canal_id: "rappi", activo: false }, error: null });
        return c;
      }),
    });

    const res = await POST(authReq("POST", { canal_id: "rappi", credenciales: {}, activo: false }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.activo).toBe(false);
  });

  // I-203
  it("I-202: POST con activo=true con credenciales → guarda como true", async () => {
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => {
        const c = buildChain();
        c.select.mockReturnValue(c);
        c.insert.mockReturnValue(c);
        c.eq.mockReturnValue(c);
        mockSingle.mockResolvedValue({
          data: { id: CONFIG_ID, canal_id: "rappi", activo: true },
          error: null,
        });
        (c as any).then = (resolve: any) =>
          resolve({ data: { id: CONFIG_ID, canal_id: "rappi", activo: true }, error: null });
        return c;
      }),
    });

    const res = await POST(authReq("POST", { canal_id: "rappi", credenciales: { api_key: "valid" }, activo: true }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.activo).toBe(true);
  });

  // I-206
  it("I-206: POST activo=true sin credenciales → 422", async () => {
    const res = await POST(authReq("POST", { canal_id: "rappi", credenciales: {}, activo: true }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("credenciales");
  });

  // I-207
  it("I-207: POST activo=true con credenciales vacías → 422", async () => {
    const res = await POST(authReq("POST", { canal_id: "rappi", credenciales: { api_key: "", api_secret: "" }, activo: true }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("credenciales");
  });
});

describe("PATCH /api/canales/config — no modifica activo si no se envía", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: STORE_ID, userId: "u1" });
  });

  function mockPatch(resultData: unknown) {
    const c = buildChain();
    c.select.mockReturnValue(c);
    c.update.mockReturnValue(c);
    c.eq.mockReturnValue(c);
    mockSingle.mockResolvedValue({ data: resultData, error: null });
    (c as any).then = (resolve: any) => resolve({ data: resultData, error: null });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => c),
    });
    return c;
  }

  // I-204
  it("I-203: PATCH sin activo en body no modifica activo", async () => {
    let updateData: Record<string, unknown> = {};
    const c = buildChain();
    c.update.mockImplementation((d: Record<string, unknown>) => {
      updateData = d;
      return c;
    });
    c.select.mockReturnValue(c);
    c.eq.mockReturnValue(c);
    mockSingle.mockResolvedValue({
      data: { id: CONFIG_ID, canal_id: "rappi", activo: true },
      error: null,
    });
    (c as any).then = (resolve: any) =>
      resolve({ data: { id: CONFIG_ID, canal_id: "rappi", activo: true }, error: null });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: jest.fn(() => c) });

    const res = await PATCH(authReq("PATCH", { canal_id: "rappi", credenciales: { api_key: "new" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activo).toBe(true);
    expect(updateData).not.toHaveProperty("activo");
  });

  // I-204
  it("I-204: PATCH con activo=false → desactiva el canal", async () => {
    mockSupResult({ id: CONFIG_ID, canal_id: "rappi", activo: false });
    const res = await PATCH(authReq("PATCH", { canal_id: "rappi", activo: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activo).toBe(false);
  });

  // I-208
  it("I-205: PATCH activo=true con credenciales en body → activa", async () => {
    let updateData: Record<string, unknown> = {};
    const c = buildChain();
    c.update.mockImplementation((d: Record<string, unknown>) => {
      updateData = d;
      return c;
    });
    c.select.mockReturnValue(c);
    c.eq.mockReturnValue(c);
    mockSingle.mockResolvedValue({
      data: { id: CONFIG_ID, canal_id: "rappi", activo: true },
      error: null,
    });
    (c as any).then = (resolve: any) =>
      resolve({ data: { id: CONFIG_ID, canal_id: "rappi", activo: true }, error: null });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: jest.fn(() => c) });

    const res = await PATCH(authReq("PATCH", { canal_id: "rappi", credenciales: { api_key: "valid" }, activo: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activo).toBe(true);
    expect(updateData.activo).toBe(true);
  });

  // I-206
  it("I-206: PATCH activo=true sin credenciales en body ni en DB → 422", async () => {
    const checkChain = buildChain();
    checkChain.select.mockReturnValue(checkChain);
    checkChain.eq.mockReturnValue(checkChain);
    mockSingle.mockResolvedValue({ data: null, error: null });
    (checkChain as any).then = (resolve: any) => resolve({ data: null, error: null });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => checkChain),
    });

    const res = await PATCH(authReq("PATCH", { canal_id: "rappi", activo: true }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("credenciales");
  });

  // I-207
  it("I-207: PATCH activo=true sin credenciales en body pero con credenciales previas en DB → ok", async () => {
    const checkChain = buildChain();
    checkChain.select.mockReturnValue(checkChain);
    checkChain.update.mockReturnValue(checkChain);
    checkChain.eq.mockReturnValue(checkChain);

    mockSingle
      .mockResolvedValueOnce({ data: { credenciales_encriptada: "existing" }, error: null })
      .mockResolvedValueOnce({ data: { id: CONFIG_ID, canal_id: "rappi", activo: true }, error: null });

    (checkChain as any).then = (resolve: any) =>
      resolve({ data: { id: CONFIG_ID, canal_id: "rappi", activo: true }, error: null });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => checkChain),
    });

    const res = await PATCH(authReq("PATCH", { canal_id: "rappi", activo: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activo).toBe(true);
  });

  function mockSupResult(data: unknown) {
    const c = buildChain();
    c.select.mockReturnValue(c);
    c.update.mockReturnValue(c);
    c.eq.mockReturnValue(c);
    mockSingle.mockResolvedValue({ data, error: null });
    (c as any).then = (resolve: any) => resolve({ data, error: null });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: jest.fn(() => c) });
  }
});