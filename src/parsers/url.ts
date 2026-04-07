export type UrlType = 'arxiv' | 'doi' | 'pubmed' | 'pdf' | 'html' | 'unknown';

export interface ClassifiedUrl {
  url: string;
  type: UrlType;
  identifier?: string;
}

export function classifyUrl(url: string): ClassifiedUrl {
  const trimmed = url.trim();

  // arXiv
  const arxivAbs = /arxiv\.org\/abs\/([^\s?#]+)/i.exec(trimmed);
  if (arxivAbs) return { url: trimmed, type: 'arxiv', identifier: arxivAbs[1] };

  const arxivPdf = /arxiv\.org\/pdf\/([^\s?#]+)/i.exec(trimmed);
  if (arxivPdf) return { url: trimmed, type: 'arxiv', identifier: arxivPdf[1] };

  // DOI URL
  const doiUrl = /(?:https?:\/\/(?:dx\.)?doi\.org\/)(10\.\S+)/i.exec(trimmed);
  if (doiUrl) return { url: trimmed, type: 'doi', identifier: doiUrl[1] };

  // Bare DOI
  const bareDoi = /^(10\.\d{4,}(\.\d+)*\/\S+)$/.exec(trimmed);
  if (bareDoi) return { url: trimmed, type: 'doi', identifier: bareDoi[1] };

  // PubMed
  const pubmed = /(?:pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pubmed)\/(\d+)/i.exec(trimmed);
  if (pubmed) return { url: trimmed, type: 'pubmed', identifier: pubmed[1] };

  // PDF by extension or content-type hint
  if (/\.pdf(\?|#|$)/i.test(trimmed)) return { url: trimmed, type: 'pdf' };

  // Anything else with http(s) is html
  if (/^https?:\/\//i.test(trimmed)) return { url: trimmed, type: 'html' };

  return { url: trimmed, type: 'unknown' };
}
