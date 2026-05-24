import axios from 'axios';
import { createLogger } from '../../utils/logger';
import type { ResolverResult } from '../../models/retrieval';
import { RESOLVER_TIMEOUT_MS } from '../config';

const logger = createLogger('unpaywall-resolver');

interface UnpaywallLocation {
  url_for_pdf?: string;
  url?: string;
  host_type?: string;
  is_best?: boolean;
}

interface UnpaywallResponse {
  doi: string;
  is_oa: boolean;
  best_oa_location?: UnpaywallLocation;
  oa_locations?: UnpaywallLocation[];
}

export class UnpaywallResolver {
  constructor(private email: string) {}

  async getOpenAccessPdf(doi: string): Promise<ResolverResult<string | null>> {
    try {
      const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(this.email)}`;
      const response = await axios.get<UnpaywallResponse>(url, { timeout: RESOLVER_TIMEOUT_MS });
      const { data } = response;

      if (!data.is_oa) return { ok: true, value: null };

      if (data.best_oa_location?.url_for_pdf) {
        return { ok: true, value: data.best_oa_location.url_for_pdf };
      }

      for (const loc of data.oa_locations || []) {
        if (loc.url_for_pdf) return { ok: true, value: loc.url_for_pdf };
      }

      return { ok: true, value: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Unpaywall lookup failed', { doi, err: message });
      return { ok: false, error: `Unpaywall lookup failed: ${message}` };
    }
  }
}
