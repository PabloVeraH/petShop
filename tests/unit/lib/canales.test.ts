const { encrypt, decrypt } = require("@/lib/canales/encryption");
const { channelRegistry, getChannel, getEnabledChannelIds } = require("@/lib/canales/registry");
const { 
  CanalId, 
  EstadoOrdenCanal, 
  CANAL_DEFAULT, 
  VENTANA_ACEPTACION,
  CUENTAS_POR_COBRAR,
  CUENTAS_COMISION 
} = require("@/lib/canales/types");

describe("Canales - Encryption", () => {
  const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
  
  beforeAll(() => {
    if (!ENCRYPTION_KEY) {
      process.env.ENCRYPTION_KEY = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";
    }
  });

  it("debe cifrar y descifrar correctamente", () => {
    const plaintext = "client_secret=abc123&client_id=xyz789";
    const encrypted = encrypt(plaintext);
    
    expect(encrypted).toHaveProperty("ciphertext");
    expect(encrypted).toHaveProperty("iv");
    expect(encrypted).toHaveProperty("authTag");
    
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("debe mantener el mismo resultado para el mismo input", () => {
    const plaintext = "test_credentials";
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);
    
    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    expect(decrypt(encrypted1)).toBe(plaintext);
    expect(decrypt(encrypted2)).toBe(plaintext);
  });
});

describe("Canales - Registry", () => {
  it("debe tener POS siempre habilitado", () => {
    const enabled = getEnabledChannelIds();
    expect(enabled).toContain("pos");
  });

  it("debe poder obtener canal por id", () => {
    const posChannel = getChannel("pos");
    expect(posChannel).toBeDefined();
    expect(posChannel.id).toBe("pos");
  });

  it("debe lanzar error para canal no instalado", () => {
    expect(() => getChannel("rappi")).toThrow();
  });
});

describe("Canales - Types", () => {
  it("debe tener constantes de canal válidas", () => {
    expect(CANAL_DEFAULT).toBe("pos");
  });

  it("debe tener ventanas de aceptación correctas", () => {
    expect(VENTANA_ACEPTACION.pos).toBe(0);
    expect(VENTANA_ACEPTACION.rappi).toBe(5);
    expect(VENTANA_ACEPTACION.pedidosya).toBe(5);
    expect(VENTANA_ACEPTACION.ubereats).toBe(8);
  });

  it("debe tener cuentas contables por canal", () => {
    expect(CUENTAS_POR_COBRAR.rappi).toBe("110401");
    expect(CUENTAS_POR_COBRAR.pedidosya).toBe("110402");
    expect(CUENTAS_POR_COBRAR.ubereats).toBe("110403");
  });

  it("debe tener cuentas de comisión por canal", () => {
    expect(CUENTAS_COMISION.rappi).toBe("510101");
    expect(CUENTAS_COMISION.pedidosya).toBe("510102");
    expect(CUENTAS_COMISION.ubereats).toBe("510103");
  });

  it("debe tener tipos válidos de CanalId", () => {
    const canalesValidos: CanalId[] = ["pos", "rappi", "pedidosya", "ubereats"];
    canalesValidos.forEach((canal) => {
      expect(CUENTAS_POR_COBRAR[canal]).toBeDefined();
    });
  });

  it("debe tener estados válidos de orden", () => {
    const estadosValidos: EstadoOrdenCanal[] = [
      "pending",
      "reserved",
      "accepted",
      "ready",
      "picked_up",
      "delivered",
      "rejected",
      "cancelled",
      "expired",
    ];
    
    expect(estadosValidos).toHaveLength(9);
  });
});

describe("Canales - PosChannel Adapter", () => {
  it("debe implementar IExternalChannel", () => {
    const posChannel = getChannel("pos");
    
    expect(posChannel).toBeDefined();
    expect(posChannel.id).toBe("pos");
    expect(posChannel.requiresWebhook).toBe(false);
  });
});