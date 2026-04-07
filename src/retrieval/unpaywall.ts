import axios from 'axios';

export class UnpaywallRetriever {
  private email: string;

  constructor(email: string) {
    this.email = email;
  }

  async getOpenAccessPdf(doi: string): Promise<string | null> {
    try {
      const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(this.email)}`;
      const response = await axios.get<UnpaywallResponse>(url, {
        timeout: 15000,
      });

      const data = response.data;
      if (!data.is_oa) return null;

      // Prefer gold/hybrid OA, then best_oa_location
      if (data.best_oa_location?.url_for_pdf) {
        return data.best_oa_location.url_for_pdf;
      }

      if (data.oa_locations && data.oa_locations.length > 0) {
        for (const loc of data.oa_locations) {
          if (loc.url_for_pdf) return loc.url_for_pdf;
        }
      }

      return null;
    } catch {
      return null;
    }
  }
}

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
