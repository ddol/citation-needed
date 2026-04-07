import axios from 'axios';
import { createLogger } from '../../utils/logger';

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

  async getOpenAccessPdf(doi: string): Promise<string | null> {
    try {
      const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(this.email)}`;
      const response = await axios.get<UnpaywallResponse>(url, { timeout: 15000 });
      const data = response.data;

      if (!data.is_oa) return null;

      if (data.best_oa_location?.url_for_pdf) {
        return data.best_oa_location.url_for_pdf;
      }

      for (const loc of data.oa_locations || []) {
        if (loc.url_for_pdf) return loc.url_for_pdf;
      }

      return null;
    } catch (err) {
      logger.warn('Unpaywall lookup failed', { doi, err: String(err) });
      return null;
    }
  }
}

/** @deprecated Use UnpaywallResolver */
export const UnpaywallRetriever = UnpaywallResolver;
