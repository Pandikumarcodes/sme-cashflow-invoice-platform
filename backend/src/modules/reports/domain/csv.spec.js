import { csvCell, csvArtifact, reportFileName } from './csv.js';
describe('CSV artifacts', () => {
  it.each(['=HYPERLINK("x")', '+cmd', '-cmd', '@SUM(A1)', ' \t=1', '\u0000+1', '\ufeff@1'])(
    'neutralizes user text formula %j',
    (text) => {
      expect(csvCell(text, true).replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );
  it('preserves trusted negative financial values and precise Decimal strings', () => {
    expect(csvCell('-9007199254740993.12')).toBe('-9007199254740993.12');
    expect(csvCell('-1.00', true)).toBe("'-1.00");
  });
  it('escapes commas, quotes, CR/LF and emits deterministic UTF-8 headers including an empty report', () => {
    const columns = [['name', true], ['amount']];
    expect(
      csvArtifact(columns, [{ name: 'Tamil தமிழ், "work"\r\nnext', amount: '0.01' }]).toString(
        'utf8',
      ),
    ).toBe('name,amount\r\n"Tamil தமிழ், ""work""\r\nnext",0.01\r\n');
    expect(csvArtifact(columns, []).toString()).toBe('name,amount\r\n');
  });
  it('bounds row count and byte size instead of silently truncating', () => {
    expect(() =>
      csvArtifact(
        [['id']],
        Array.from({ length: 10001 }, () => ({ id: 'x' })),
      ),
    ).toThrow();
    expect(() => csvArtifact([['text']], [{ text: 'x'.repeat(10 * 1024 * 1024) }])).toThrow();
  });
  it('uses server-controlled type and opaque ID for a safe filename', () =>
    expect(reportFileName({ reportType: 'CASH_FLOW', id: 'opaque' })).toBe('cash_flow-opaque.csv'));
});
