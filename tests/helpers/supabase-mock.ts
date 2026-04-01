/**
 * Factory para crear mocks de Supabase chainables.
 * Uso: const { mockSupabase, mockFrom } = createSupabaseMock();
 */
export function createSupabaseMock() {
  const mockSingle = jest.fn();
  const mockSelect = jest.fn();
  const mockInsert = jest.fn();
  const mockUpdate = jest.fn();
  const mockUpsert = jest.fn();
  const mockDelete = jest.fn();
  const mockEq = jest.fn();
  const mockIlike = jest.fn();
  const mockOr = jest.fn();
  const mockOrder = jest.fn();
  const mockRange = jest.fn();
  const mockGt = jest.fn();
  const mockIn = jest.fn();
  const mockRpc = jest.fn();

  // Build a chainable query builder
  const chain: Record<string, jest.Mock> = {};
  const builder = () => chain;

  chain.select = mockSelect.mockReturnValue(chain);
  chain.insert = mockInsert.mockReturnValue(chain);
  chain.update = mockUpdate.mockReturnValue(chain);
  chain.upsert = mockUpsert.mockReturnValue(chain);
  chain.delete = mockDelete.mockReturnValue(chain);
  chain.eq = mockEq.mockReturnValue(chain);
  chain.ilike = mockIlike.mockReturnValue(chain);
  chain.or = mockOr.mockReturnValue(chain);
  chain.order = mockOrder.mockReturnValue(chain);
  chain.range = mockRange.mockReturnValue(chain);
  chain.gt = mockGt.mockReturnValue(chain);
  chain.in = mockIn.mockReturnValue(chain);
  chain.single = mockSingle;
  chain.rpc = mockRpc;

  const mockFrom = jest.fn().mockReturnValue(chain);

  const mockSupabase = {
    from: mockFrom,
    rpc: mockRpc,
  };

  return {
    mockSupabase,
    mockFrom,
    mockSingle,
    mockSelect,
    mockInsert,
    mockUpdate,
    mockUpsert,
    mockEq,
    mockOr,
    mockRpc,
    chain,
  };
}
