import type { Database } from '../../../src/db/index';
import { handleGroundingTool } from '../../../src/mcp/tools/grounding';
import { SearchService } from '../../../src/services/search';
import { ContentService } from '../../../src/services/content';
import { VerifyQuoteService } from '../../../src/services/verify-quote';

const mockSearch = jest.fn();
const mockRead = jest.fn();
const mockVerify = jest.fn();

jest.mock('../../../src/services/search', () => ({
  SearchService: jest.fn().mockImplementation(() => ({
    search: mockSearch,
  })),
}));

jest.mock('../../../src/services/content', () => ({
  ContentService: jest.fn().mockImplementation(() => ({
    read: mockRead,
  })),
}));

jest.mock('../../../src/services/verify-quote', () => ({
  VerifyQuoteService: jest.fn().mockImplementation(() => ({
    verify: mockVerify,
  })),
}));

const db = {} as Database;

describe('MCP grounding tool handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns search results as JSON', async () => {
    mockSearch.mockReturnValue({ results: [{ citation: { doi: '10/a' } }], nextCursor: 'next' });

    const result = await handleGroundingTool('search-citations', { query: 'lidar' }, db);

    expect(SearchService).toHaveBeenCalledWith(db);
    expect(JSON.parse(result?.content[0].text ?? '{}').nextCursor).toBe('next');
  });

  test('handles read-content statuses', async () => {
    mockRead.mockReturnValueOnce({ status: 'unknown-doi' });
    const unknown = await handleGroundingTool('read-content', { doi: '10/missing' }, db);
    expect(unknown?.content[0].text).toContain('Citation not found');

    mockRead.mockReturnValueOnce({ status: 'no-markdown' });
    const noMarkdown = await handleGroundingTool('read-content', { doi: '10/nomd' }, db);
    expect(noMarkdown?.content[0].text).toContain('No extracted Markdown for 10/nomd');

    mockRead.mockReturnValueOnce({ status: 'ok', response: { text: 'body' } });
    const ok = await handleGroundingTool('read-content', { doi: '10/read' }, db);
    expect(JSON.parse(ok?.content[0].text ?? '{}').text).toBe('body');
    expect(ContentService).toHaveBeenCalledWith(db);
  });

  test('handles verify-quote statuses', async () => {
    mockVerify.mockReturnValueOnce({ status: 'quote-too-short' });
    const tooShort = await handleGroundingTool('verify-quote', { quote: 'tiny' }, db);
    expect(tooShort?.isError).toBe(true);
    expect(tooShort?.content[0].text).toContain('Quote too short');

    mockVerify.mockReturnValueOnce({ status: 'unknown-doi' });
    const unknown = await handleGroundingTool(
      'verify-quote',
      { quote: 'long enough quote', doi: '10/missing' },
      db
    );
    expect(unknown?.content[0].text).toContain('Citation not found');

    mockVerify.mockReturnValueOnce({ status: 'no-markdown' });
    const noMarkdown = await handleGroundingTool(
      'verify-quote',
      { quote: 'long enough quote', doi: '10/nomd' },
      db
    );
    expect(noMarkdown?.content[0].text).toContain('No extracted Markdown for 10/nomd');

    mockVerify.mockReturnValueOnce({ status: 'ok', response: { verdict: 'exact' } });
    const ok = await handleGroundingTool('verify-quote', { quote: 'long enough quote' }, db);
    expect(JSON.parse(ok?.content[0].text ?? '{}').verdict).toBe('exact');
    expect(VerifyQuoteService).toHaveBeenCalledWith(db);
  });

  test('returns null for unknown tools and validation errors for bad arguments', async () => {
    await expect(handleGroundingTool('unknown', {}, db)).resolves.toBeNull();

    const result = await handleGroundingTool('search-citations', { query: '' }, db);

    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain('Invalid arguments for search-citations');
  });
});
