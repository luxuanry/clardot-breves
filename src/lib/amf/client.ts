import { AMF_FIELDS, type AmfRecord } from "./normalize";

const BASE_URL =
  "https://www.info-financiere.gouv.fr/api/explore/v2.1/catalog/datasets/flux-amf-new-prod/records";

/** The API rejects limit > 100. */
const PAGE_SIZE = 100;
/** Opendatasoft caps offset + limit at 10 000 on the records endpoint. */
const MAX_RECORDS = 10_000;

interface RecordsResponse {
  total_count: number;
  results: AmfRecord[];
}

/** Builds the ODSQL where clause for a [from, to) window on the AMF filing timestamp. */
export function buildWhere(from: Date, to: Date): string {
  return `uin_dat_amf >= date'${from.toISOString()}' and uin_dat_amf < date'${to.toISOString()}'`;
}

/**
 * Fetches every record filed between `from` and `to`, newest first, paging through
 * the API. A few days of data is typically 300 to 600 records, i.e. a handful of calls.
 */
export async function fetchAmfRecords(
  from: Date,
  to: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<AmfRecord[]> {
  const records: AmfRecord[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total && offset < MAX_RECORDS) {
    const params = new URLSearchParams({
      where: buildWhere(from, to),
      order_by: "uin_dat_amf desc",
      limit: String(PAGE_SIZE),
      offset: String(offset),
      select: AMF_FIELDS.join(","),
    });
    const res = await fetchImpl(`${BASE_URL}?${params}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`info-financiere API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const page = (await res.json()) as RecordsResponse;
    total = page.total_count;
    records.push(...page.results);
    if (page.results.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return records;
}
